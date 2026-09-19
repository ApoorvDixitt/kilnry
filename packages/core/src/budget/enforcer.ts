// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { and, eq, gte, inArray, like, lt, sql } from 'drizzle-orm';
import type { DatabaseState } from '@kilnry/db';
import { budgets, jobs, providers, spendLedger } from '@kilnry/db';
import { KilnryError } from '../errors.js';
import type { Estimate, ProviderId } from '../types.js';

function number(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid monetary value in the database: ${String(value)}`);
  return parsed;
}

export function assertCostConfirmation(estimate: Estimate, confirmedCostUsd: number | undefined): void {
  const required = estimate.authoritative_usd ?? estimate.estimate_usd;
  if (required === 0) return;
  if (confirmedCostUsd === undefined || confirmedCostUsd < required * 0.9) {
    throw new KilnryError(
      'CONFIRMATION_REQUIRED',
      `Waiting for cost confirmation: ${estimate.authoritative_usd === undefined ? '≈ ' : ''}$${required.toFixed(4)}.`,
      {
        details: { estimate, required_cost_usd: required },
      },
    );
  }
}

export type BudgetDatabase = Pick<DatabaseState['db'], 'select'>;

function startOfDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function startOfMonth(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

async function ledgerTotal(
  database: BudgetDatabase,
  from: Date,
  provider?: ProviderId,
  folder?: string,
): Promise<number> {
  const conditions = [gte(spendLedger.occurredAt, from)];
  if (provider) conditions.push(eq(spendLedger.providerId, provider));
  if (folder) conditions.push(like(spendLedger.folder, `${folder}%`));
  const rows = await database
    .select({ total: sql<string>`coalesce(sum(${spendLedger.actualUsd}), 0)` })
    .from(spendLedger)
    .where(and(...conditions));
  return number(rows[0]?.total);
}

async function openReservations(
  database: BudgetDatabase,
  provider?: ProviderId,
  folder?: string,
): Promise<number> {
  const conditions = [inArray(jobs.status, ['queued', 'running', 'waiting'])];
  if (provider) conditions.push(eq(jobs.providerId, provider));
  if (folder) conditions.push(like(jobs.targetFolder, `${folder}%`));
  const rows = await database
    .select({ total: sql<string>`coalesce(sum(${jobs.estimateUsd}), 0)` })
    .from(jobs)
    .where(and(...conditions));
  return number(rows[0]?.total);
}

interface BudgetCheck {
  scope: string;
  cap: number;
  spent: number;
  reset: string;
  behavior: string;
}

export async function reserveBudget(
  database: BudgetDatabase,
  input: {
    estimate_usd: number;
    provider: ProviderId;
    folder: string;
    now?: Date;
    override_budget?: boolean;
  },
): Promise<void> {
  const now = input.now ?? new Date();
  const capRows = await database.select().from(budgets);
  const capMap = new Map(capRows.map((row) => [row.scope, row]));
  const checks: BudgetCheck[] = [];
  const daily = capMap.get('daily');
  if (daily?.capUsd)
    checks.push({
      scope: 'Daily',
      cap: number(daily.capUsd),
      spent: (await ledgerTotal(database, startOfDay(now))) + (await openReservations(database)),
      reset: 'midnight',
      behavior: daily.behavior,
    });
  const monthly = capMap.get('monthly');
  if (monthly?.capUsd)
    checks.push({
      scope: 'Monthly',
      cap: number(monthly.capUsd),
      spent: (await ledgerTotal(database, startOfMonth(now))) + (await openReservations(database)),
      reset: 'the first of next month',
      behavior: monthly.behavior,
    });
  const folderCaps = capRows.filter(
    (row) => row.scope.startsWith('folder:') && input.folder.startsWith(row.scope.slice(7)),
  );
  for (const cap of folderCaps) {
    if (!cap.capUsd) continue;
    const folder = cap.scope.slice(7);
    checks.push({
      scope: folder || 'Folder',
      cap: number(cap.capUsd),
      spent:
        (await ledgerTotal(database, startOfMonth(now), undefined, folder)) +
        (await openReservations(database, undefined, folder)),
      reset: 'you raise the cap',
      behavior: cap.behavior,
    });
  }
  const providerRows = await database
    .select({ cap: providers.monthlyCapUsd })
    .from(providers)
    .where(eq(providers.id, input.provider))
    .limit(1);
  if (providerRows[0]?.cap)
    checks.push({
      scope: `${input.provider} monthly`,
      cap: number(providerRows[0].cap),
      spent:
        (await ledgerTotal(database, startOfMonth(now), input.provider)) +
        (await openReservations(database, input.provider)),
      reset: 'the first of next month',
      behavior: 'block',
    });

  const exceeded = checks.find((check) => check.spent + input.estimate_usd > check.cap);
  if (!exceeded || input.override_budget) return;
  const code = exceeded.behavior === 'ask' ? 'CONFIRMATION_REQUIRED' : 'BUDGET_EXCEEDED';
  throw new KilnryError(
    code,
    `${exceeded.scope} cap $${exceeded.cap.toFixed(2)} reached ($${exceeded.spent.toFixed(2)} spent). Raise the cap or wait until ${exceeded.reset}. Nothing was spent.`,
    {
      details: {
        scope: exceeded.scope,
        cap_usd: exceeded.cap,
        spent_usd: exceeded.spent,
        estimate_usd: input.estimate_usd,
      },
    },
  );
}

export async function ledgerTotalForJob(state: DatabaseState, jobId: string): Promise<number> {
  const rows = await state.db
    .select({ total: sql<string>`coalesce(sum(${spendLedger.actualUsd}), 0)` })
    .from(spendLedger)
    .where(and(eq(spendLedger.jobId, jobId), lt(spendLedger.occurredAt, new Date(Date.now() + 60_000))));
  return number(rows[0]?.total);
}

export interface BudgetStatusLine {
  scope: 'daily' | 'monthly' | 'folder' | 'provider';
  label: string;
  cap_usd: number;
  spent_usd: number;
  reserved_usd: number;
  behavior: string;
}

// The current caps and how much of each is spent (ledger) and reserved
// (in-flight jobs), for the cost strip and the budget settings page. Returns one
// line per configured cap; scopes with no cap set are omitted.
export async function budgetStatus(
  database: BudgetDatabase,
  now: Date = new Date(),
): Promise<BudgetStatusLine[]> {
  const capRows = await database.select().from(budgets);
  const lines: BudgetStatusLine[] = [];
  const capMap = new Map(capRows.map((row) => [row.scope, row]));

  const daily = capMap.get('daily');
  if (daily?.capUsd) {
    lines.push({
      scope: 'daily',
      label: 'Today',
      cap_usd: number(daily.capUsd),
      spent_usd: await ledgerTotal(database, startOfDay(now)),
      reserved_usd: await openReservations(database),
      behavior: daily.behavior,
    });
  }
  const monthly = capMap.get('monthly');
  if (monthly?.capUsd) {
    lines.push({
      scope: 'monthly',
      label: 'This month',
      cap_usd: number(monthly.capUsd),
      spent_usd: await ledgerTotal(database, startOfMonth(now)),
      reserved_usd: await openReservations(database),
      behavior: monthly.behavior,
    });
  }
  for (const row of capRows) {
    if (!row.scope.startsWith('folder:') || !row.capUsd) continue;
    const folder = row.scope.slice(7);
    lines.push({
      scope: 'folder',
      label: folder,
      cap_usd: number(row.capUsd),
      spent_usd: await ledgerTotal(database, startOfMonth(now), undefined, folder),
      reserved_usd: await openReservations(database, undefined, folder),
      behavior: row.behavior,
    });
  }
  return lines;
}

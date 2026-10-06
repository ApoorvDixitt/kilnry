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

/**
 * Refuse a spend priced from a snapshot older than price_max_age_days (30)
 * unless the caller explicitly allows the stale estimate (PRD-14 §8 "Stale
 * prices cannot be used without the override"; TRD-07 §6.3: CONFIRMATION_REQUIRED
 * with reason stale_price). The job engine applies the same rule in createJob;
 * this is the check for the paid paths that do not go through a job (F-21).
 */
export function assertFreshPrice(estimate: Estimate, allowStale: boolean | undefined): void {
  // An injected engine (the analyze tool's) may hand back an estimate without
  // adjustments; only a named stale_price refuses.
  const stale = Array.isArray(estimate.adjustments) && estimate.adjustments.includes('stale_price');
  if (allowStale === true || !stale) return;
  throw new KilnryError(
    'CONFIRMATION_REQUIRED',
    'This price snapshot is older than 30 days. Refresh provider prices before paying for this, or explicitly allow the stale estimate.',
    { details: { reason: 'stale_price', stale_price: true, estimate } },
  );
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

// The one advisory lock every budget check-and-reserve takes (the job engine's
// createJob and the holds below), so two concurrent reservations serialise and
// a cap with room for one admits exactly one (F-PRV-04).
export const BUDGET_LOCK_ID = 1_264_843_079;

export interface SpendHold {
  ledger_id: string;
  estimate_usd: number;
}

/**
 * Reserve a spend that does not go through the job queue (a voice clone or
 * design): inside one transaction, under the budget lock, check the caps and
 * write a spend-ledger row at the estimate with currencyNote 'pending', so the
 * money is held before the provider call and a concurrent request sees it
 * (PRD-14 "reserve"; F-PRV-04). ledgerTotal sums actual_usd, so a pending row
 * counts at once. Settle it to the real charge on success, release it when the
 * provider reports no charge, and leave it in place on an ambiguous outcome.
 */
export async function holdSpend(
  state: DatabaseState,
  input: {
    ledger_id: string;
    estimate_usd: number;
    provider: ProviderId;
    model_id: string;
    kind: string;
    folder: string;
    character_ids?: string[];
    now?: Date;
    override_budget?: boolean;
  },
): Promise<SpendHold> {
  const now = input.now ?? new Date();
  await state.db.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(${BUDGET_LOCK_ID})`);
    await reserveBudget(transaction, {
      estimate_usd: input.estimate_usd,
      provider: input.provider,
      folder: input.folder,
      now,
      ...(input.override_budget === undefined ? {} : { override_budget: input.override_budget }),
    });
    await transaction.insert(spendLedger).values({
      id: input.ledger_id,
      providerId: input.provider,
      modelId: input.model_id,
      folder: input.folder,
      kind: input.kind,
      ...(input.character_ids ? { characterIds: input.character_ids } : {}),
      estimateUsd: input.estimate_usd.toFixed(6),
      actualUsd: input.estimate_usd.toFixed(6),
      currencyNote: 'pending',
      occurredAt: now,
    });
  });
  return { ledger_id: input.ledger_id, estimate_usd: input.estimate_usd };
}

/** The provider charged: the held row becomes the real ledger entry. */
export async function settleHold(
  state: DatabaseState,
  hold: SpendHold,
  settlement: { actual_usd: number; note: string; occurred_at?: Date; model_id?: string },
): Promise<void> {
  await state.db
    .update(spendLedger)
    .set({
      actualUsd: settlement.actual_usd.toFixed(6),
      currencyNote: settlement.note,
      ...(settlement.model_id ? { modelId: settlement.model_id } : {}),
      ...(settlement.occurred_at ? { occurredAt: settlement.occurred_at } : {}),
    })
    .where(eq(spendLedger.id, hold.ledger_id));
}

/** The provider reported no charge: the hold is released. */
export async function releaseHold(state: DatabaseState, hold: SpendHold): Promise<void> {
  await state.db.delete(spendLedger).where(eq(spendLedger.id, hold.ledger_id));
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
  /** When this cap frees up again, in the words the error uses (F-19). */
  reset: string;
  /** The spend as a whole percentage of the cap, for the 80 % warning (F-18). */
  used_percent: number;
}

/** PRD-14 §5: the share of a cap at which the user is warned once a day. */
export const BUDGET_WARN_PERCENT = 80;

export function budgetReset(scope: BudgetStatusLine['scope']): string {
  switch (scope) {
    case 'daily':
      return 'midnight';
    case 'monthly':
    case 'provider':
      return 'the first of next month';
    case 'folder':
      return 'you raise the cap';
  }
}

// The current caps and how much of each is spent (ledger) and reserved
// (in-flight jobs), for the cost strip and the budget settings page. Returns one
// line per configured cap; scopes with no cap set are omitted.
export async function budgetStatus(
  database: BudgetDatabase,
  now: Date = new Date(),
): Promise<BudgetStatusLine[]> {
  const capRows = await database.select().from(budgets);
  const lines: Array<Omit<BudgetStatusLine, 'reset' | 'used_percent'>> = [];
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
  // The reset wording and the percentage are derived once here, so the meter,
  // the strip and the 80 % banner all say the same thing (F-18, F-19).
  return lines.map((line) => ({
    ...line,
    reset: budgetReset(line.scope),
    used_percent:
      line.cap_usd > 0 ? Math.floor(((line.spent_usd + line.reserved_usd) / line.cap_usd) * 100) : 0,
  }));
}

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The spend ledger (F-PRV-05). It reads the spend_ledger table — the record of
// what every terminal job actually cost — and groups it by provider, model,
// folder, character or day so Settings › Budget and the kilnry_budget tool can
// show where the money went. It also serialises one row per job to a
// comma-separated-values (CSV) file for a spreadsheet, with the exact columns
// PRD-14 §6 fixes and actual costs to four decimal places.

import { and, gte, lte } from 'drizzle-orm';
import { jobs, spendLedger, type DatabaseState } from '@kilnry/db';

export type LedgerGroupBy = 'provider' | 'model' | 'folder' | 'character' | 'day';

export interface LedgerGroup {
  key: string;
  jobs: number;
  estimate_usd: number;
  actual_usd: number;
  delta_usd: number;
}

export interface LedgerRow {
  occurred_at: string;
  job_id: string;
  source: string;
  provider: string;
  model: string;
  kind: string;
  folder: string;
  characters: string;
  estimate_usd: number;
  actual_usd: number;
  currency_note: string;
  provider_request_id: string;
}

function number(value: string | number | null): number {
  return value === null ? 0 : typeof value === 'number' ? value : Number(value);
}

// Read the ledger rows for a period and join each to its job in memory so the
// source and provider request id are available for the CSV, without relying on
// a SQL join the embedded database may order differently.
async function ledgerRows(db: DatabaseState, from: Date, to: Date): Promise<LedgerRow[]> {
  const ledger = await db.db
    .select()
    .from(spendLedger)
    .where(and(gte(spendLedger.occurredAt, from), lte(spendLedger.occurredAt, to)));
  const jobRows = await db.db
    .select({ id: jobs.id, source: jobs.source, prid: jobs.providerRequestId })
    .from(jobs);
  const jobById = new Map(jobRows.map((row) => [row.id, row]));
  return ledger.map((row) => {
    const job = row.jobId ? jobById.get(row.jobId) : undefined;
    return {
      occurred_at: row.occurredAt.toISOString(),
      job_id: row.jobId ?? '',
      source: job?.source ?? '',
      provider: row.providerId ?? '',
      model: row.modelId ?? '',
      kind: row.kind ?? '',
      folder: row.folder ?? '',
      characters: (row.characterIds ?? []).join(' '),
      estimate_usd: number(row.estimateUsd),
      actual_usd: number(row.actualUsd),
      currency_note: row.currencyNote ?? '',
      provider_request_id: job?.prid ?? '',
    };
  });
}

// Group a period's spend by one dimension, newest-heaviest first.
export async function spendLedgerGrouped(
  db: DatabaseState,
  input: { from: Date; to: Date; group_by: LedgerGroupBy },
): Promise<LedgerGroup[]> {
  const rows = await ledgerRows(db, input.from, input.to);
  const groups = new Map<string, LedgerGroup>();
  for (const row of rows) {
    const keys =
      input.group_by === 'provider'
        ? [row.provider || '—']
        : input.group_by === 'model'
          ? [row.model || '—']
          : input.group_by === 'folder'
            ? [row.folder || '—']
            : input.group_by === 'day'
              ? [row.occurred_at.slice(0, 10)]
              : row.characters
                ? row.characters.split(' ')
                : ['—'];
    for (const key of keys) {
      const group = groups.get(key) ?? { key, jobs: 0, estimate_usd: 0, actual_usd: 0, delta_usd: 0 };
      group.jobs += 1;
      group.estimate_usd += row.estimate_usd;
      group.actual_usd += row.actual_usd;
      group.delta_usd = group.actual_usd - group.estimate_usd;
      groups.set(key, group);
    }
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      estimate_usd: Number(group.estimate_usd.toFixed(4)),
      actual_usd: Number(group.actual_usd.toFixed(4)),
      delta_usd: Number(group.delta_usd.toFixed(4)),
    }))
    .sort((left, right) => right.actual_usd - left.actual_usd);
}

// Fetch the raw per-job rows for a period (for the CSV and the table).
export async function spendLedgerEntries(
  db: DatabaseState,
  input: { from: Date; to: Date },
): Promise<LedgerRow[]> {
  const rows = await ledgerRows(db, input.from, input.to);
  return rows.sort((left, right) => left.occurred_at.localeCompare(right.occurred_at));
}

// Escape one CSV field: wrap in quotes and double any inner quotes when it holds
// a comma, quote or newline.
function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

const CSV_HEADER = [
  'occurred_at',
  'job_id',
  'source',
  'provider',
  'model',
  'kind',
  'folder',
  'characters',
  'estimate_usd',
  'actual_usd',
  'currency_note',
  'provider_request_id',
] as const;

// Serialise ledger rows to CSV text with the fixed PRD-14 §6 columns; actual and
// estimated costs are written with four decimal places.
export function spendLedgerCsv(rows: LedgerRow[]): string {
  const lines = [CSV_HEADER.join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.occurred_at,
        row.job_id,
        row.source,
        row.provider,
        row.model,
        row.kind,
        row.folder,
        row.characters,
        row.estimate_usd.toFixed(4),
        row.actual_usd.toFixed(4),
        row.currency_note,
        row.provider_request_id,
      ]
        .map((field) => csvField(String(field)))
        .join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

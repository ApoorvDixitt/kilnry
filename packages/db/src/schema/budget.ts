// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { index, numeric, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const budgets = pgTable('budgets', {
  scope: text('scope').primaryKey(),
  capUsd: numeric('cap_usd', { precision: 12, scale: 6 }),
  behavior: text('behavior').notNull().default('block'),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});
export const spendLedger = pgTable(
  'spend_ledger',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id'),
    providerId: text('provider_id'),
    modelId: text('model_id'),
    folder: text('folder'),
    characterIds: text('character_ids').array(),
    kind: text('kind'),
    estimateUsd: numeric('estimate_usd', { precision: 12, scale: 6 }),
    actualUsd: numeric('actual_usd', { precision: 12, scale: 6 }).notNull(),
    currencyNote: text('currency_note'),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [index('spend_day_idx').on(table.occurredAt)],
);

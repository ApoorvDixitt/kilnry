// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const jobs = pgTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    status: text('status').notNull().default('queued'),
    source: text('source').notNull(),
    providerId: text('provider_id'),
    modelId: text('model_id'),
    request: jsonb('request').$type<Record<string, unknown>>().notNull(),
    resolved: jsonb('resolved').$type<Record<string, unknown>>(),
    characters: jsonb('characters').$type<unknown[]>().notNull().default([]),
    medias: jsonb('medias').$type<unknown[]>().notNull().default([]),
    adjustments: text('adjustments').array(),
    estimateUsd: numeric('estimate_usd', { precision: 12, scale: 6 }),
    authoritativeUsd: numeric('authoritative_usd', { precision: 12, scale: 6 }),
    actualUsd: numeric('actual_usd', { precision: 12, scale: 6 }),
    unitPrice: jsonb('unit_price').$type<Record<string, unknown>>(),
    providerRequestId: text('provider_request_id'),
    providerStatusUrl: text('provider_status_url'),
    progress: numeric('progress', { precision: 4, scale: 3 }),
    stepLabel: text('step_label'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    retryable: boolean('retryable'),
    attempts: integer('attempts').notNull().default(0),
    runId: text('run_id'),
    stepId: text('step_id'),
    presetId: text('preset_id'),
    chatSessionId: text('chat_session_id'),
    clientRequestId: text('client_request_id'),
    targetFolder: text('target_folder'),
    outputAssetIds: text('output_asset_ids').array(),
    confirmedCostUsd: numeric('confirmed_cost_usd', { precision: 12, scale: 6 }),
    confirmedBy: text('confirmed_by'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('jobs_status_idx').on(table.status, table.createdAt),
    uniqueIndex('jobs_client_request_idx').on(table.clientRequestId),
  ],
);

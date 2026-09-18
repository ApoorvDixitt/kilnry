// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const models = pgTable(
  'models',
  {
    id: text('id').primaryKey(),
    providerId: text('provider_id').notNull(),
    modelId: text('model_id').notNull(),
    displayName: text('display_name').notNull(),
    capabilities: text('capabilities').array().notNull(),
    paramsSchema: jsonb('params_schema').$type<Record<string, unknown>>().notNull(),
    mediaRoles: jsonb('media_roles').$type<unknown[]>().notNull(),
    supports: jsonb('supports').$type<Record<string, unknown>>().notNull(),
    priceRule: jsonb('price_rule').$type<Record<string, unknown>>().notNull(),
    retentionDays: integer('retention_days'),
    moderation: jsonb('moderation').$type<Record<string, unknown>>(),
    qualityTier: text('quality_tier'),
    tags: text('tags').array(),
    deprecatedAt: timestamp('deprecated_at', { withTimezone: true, mode: 'date' }),
    sourceUrl: text('source_url'),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('models_provider_model_idx').on(table.providerId, table.modelId)],
);

export const priceSnapshots = pgTable(
  'price_snapshots',
  {
    id: text('id').primaryKey(),
    modelUlid: text('model_ulid').notNull(),
    unit: text('unit').notNull(),
    amountUsd: numeric('amount_usd', { precision: 12, scale: 6 }).notNull(),
    tiers: jsonb('tiers').$type<unknown>(),
    source: text('source'),
    sourceUrl: text('source_url'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [index('price_snapshots_model_idx').on(table.modelUlid, table.fetchedAt)],
);

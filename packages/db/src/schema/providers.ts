// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { boolean, customType, jsonb, numeric, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Uint8Array }>({ dataType: () => 'bytea' });

export const providers = pgTable('providers', {
  id: text('id').primaryKey(),
  enabled: boolean('enabled').notNull().default(false),
  status: text('status').notNull().default('not_connected'),
  degradedUntil: timestamp('degraded_until', { withTimezone: true, mode: 'date' }),
  lastError: text('last_error'),
  lastTestedAt: timestamp('last_tested_at', { withTimezone: true, mode: 'date' }),
  baseUrl: text('base_url'),
  extra: jsonb('extra').$type<Record<string, unknown>>().notNull().default({}),
  monthlyCapUsd: numeric('monthly_cap_usd', { precision: 12, scale: 6 }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const providerKeys = pgTable('provider_keys', {
  id: text('id').primaryKey(),
  providerId: text('provider_id')
    .notNull()
    .references(() => providers.id, { onDelete: 'cascade' }),
  label: text('label'),
  keyPrefix: text('key_prefix'),
  keyCiphertext: bytea('key_ciphertext').notNull(),
  nonce: bytea('nonce').notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

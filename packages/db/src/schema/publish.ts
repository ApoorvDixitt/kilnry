// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { customType, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Uint8Array }>({ dataType: () => 'bytea' });
export const publishAccounts = pgTable('publish_accounts', {
  id: text('id').primaryKey(),
  platform: text('platform').notNull(),
  displayName: text('display_name'),
  externalId: text('external_id'),
  tokenCiphertext: bytea('token_ciphertext'),
  nonce: bytea('nonce'),
  status: text('status'),
  connectedAt: timestamp('connected_at', { withTimezone: true, mode: 'date' }),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
});
export const publishPosts = pgTable('publish_posts', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  assetId: text('asset_id'),
  mode: text('mode'),
  publishId: text('publish_id'),
  status: text('status'),
  title: text('title'),
  meta: jsonb('meta').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

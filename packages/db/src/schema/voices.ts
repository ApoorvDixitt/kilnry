// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import {
  boolean,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const voices = pgTable(
  'voices',
  {
    id: text('id').primaryKey(),
    providerId: text('provider_id').notNull(),
    voiceId: text('voice_id').notNull(),
    name: text('name'),
    language: text('language'),
    gender: text('gender'),
    tags: text('tags').array(),
    isClone: boolean('is_clone').notNull().default(false),
    cloneKind: text('clone_kind'),
    sampleAssetId: text('sample_asset_id'),
    previewAssetId: text('preview_asset_id'),
    consentConfirmedAt: timestamp('consent_confirmed_at', { withTimezone: true, mode: 'date' }),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6 }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('voices_provider_voice_idx').on(table.providerId, table.voiceId)],
);

export const characterVoices = pgTable(
  'character_voices',
  {
    characterId: text('character_id').notNull(),
    version: integer('version').notNull(),
    voiceUlid: text('voice_ulid').notNull(),
  },
  (table) => [primaryKey({ columns: [table.characterId, table.version] })],
);

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import {
  boolean,
  customType,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Uint8Array }>({ dataType: () => 'bytea' });

export const characters = pgTable('characters', {
  id: text('id').primaryKey(),
  handle: text('handle').notNull().unique(),
  kind: text('kind').notNull(),
  displayName: text('display_name').notNull(),
  description: text('description'),
  tags: text('tags').array(),
  isRealPerson: boolean('is_real_person').notNull().default(false),
  consentStatus: text('consent_status').notNull().default('n/a'),
  consentEvidenceAssetId: text('consent_evidence_asset_id'),
  consentGrantedAt: timestamp('consent_granted_at', { withTimezone: true, mode: 'date' }),
  license: text('license').notNull().default('private'),
  currentVersion: integer('current_version').notNull().default(1),
  usageCount: integer('usage_count').notNull().default(0),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
});

export const characterVersions = pgTable(
  'character_versions',
  {
    characterId: text('character_id').notNull(),
    version: integer('version').notNull(),
    parentVersion: integer('parent_version'),
    appearance: jsonb('appearance').$type<Record<string, unknown>>(),
    injectionDefaults: jsonb('injection_defaults').$type<Record<string, unknown>>(),
    castParams: jsonb('cast_params').$type<Record<string, unknown>>(),
    frozen: boolean('frozen').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.characterId, table.version] })],
);

export const characterReferences = pgTable('character_references', {
  id: text('id').primaryKey(),
  characterId: text('character_id').notNull(),
  version: integer('version').notNull(),
  assetId: text('asset_id').notNull(),
  role: text('role').notNull(),
  view: text('view'),
  label: text('label'),
  weight: numeric('weight', { precision: 3, scale: 2 }).notNull().default('1'),
  position: integer('position'),
  faceEmbedding: bytea('face_embedding'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const trainedIdentities = pgTable('trained_identities', {
  id: text('id').primaryKey(),
  characterId: text('character_id').notNull(),
  version: integer('version').notNull(),
  providerId: text('provider_id').notNull(),
  kind: text('kind').notNull(),
  remoteId: text('remote_id'),
  artifactUrl: text('artifact_url'),
  localPath: text('local_path'),
  sha256: text('sha256'),
  baseModel: text('base_model'),
  triggerWord: text('trigger_word'),
  defaultScale: numeric('default_scale', { precision: 3, scale: 2 }),
  status: text('status').notNull(),
  jobId: text('job_id'),
  costUsd: numeric('cost_usd', { precision: 12, scale: 6 }),
  trainedAt: timestamp('trained_at', { withTimezone: true, mode: 'date' }),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
  sourceAssetIds: text('source_asset_ids').array(),
  error: text('error'),
});

export const characterHandleAliases = pgTable(
  'character_handle_aliases',
  {
    alias: text('alias').primaryKey(),
    characterId: text('character_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('character_alias_idx').on(table.alias)],
);

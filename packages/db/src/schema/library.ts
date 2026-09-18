// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const folders = pgTable('folders', {
  path: text('path').primaryKey(),
  name: text('name').notNull(),
  parentPath: text('parent_path'),
  assetCount: integer('asset_count').notNull().default(0),
  projectNotes: text('project_notes'),
  defaultCharacter: text('default_character'),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }),
});

export const assets = pgTable(
  'assets',
  {
    id: text('id').primaryKey(),
    path: text('path').notNull().unique(),
    folderPath: text('folder_path'),
    kind: text('kind').notNull(),
    mime: text('mime'),
    bytes: bigint('bytes', { mode: 'number' }),
    sha256: text('sha256'),
    width: integer('width'),
    height: integer('height'),
    durationS: numeric('duration_s', { precision: 10, scale: 3 }),
    fps: numeric('fps', { precision: 6, scale: 2 }),
    hasAudio: boolean('has_audio'),
    source: text('source'),
    providerId: text('provider_id'),
    modelId: text('model_id'),
    prompt: text('prompt'),
    resolvedPrompt: text('resolved_prompt'),
    negativePrompt: text('negative_prompt'),
    params: jsonb('params').$type<Record<string, unknown>>(),
    seed: bigint('seed', { mode: 'number' }),
    estimateUsd: numeric('estimate_usd', { precision: 12, scale: 6 }),
    actualUsd: numeric('actual_usd', { precision: 12, scale: 6 }),
    jobId: text('job_id'),
    runId: text('run_id'),
    stepId: text('step_id'),
    providerRequestId: text('provider_request_id'),
    moderation: jsonb('moderation').$type<Record<string, unknown>>(),
    retentionUntil: timestamp('retention_until', { withTimezone: true, mode: 'date' }),
    label: text('label'),
    rating: smallint('rating').notNull().default(0),
    userNotes: text('user_notes'),
    consistency: jsonb('consistency').$type<Record<string, unknown>>(),
    sidecarOk: boolean('sidecar_ok').notNull().default(true),
    sidecarMtime: timestamp('sidecar_mtime', { withTimezone: true, mode: 'date' }),
    fileMtime: timestamp('file_mtime', { withTimezone: true, mode: 'date' }),
    trashedAt: timestamp('trashed_at', { withTimezone: true, mode: 'date' }),
    originalPath: text('original_path'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
    indexedAt: timestamp('indexed_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [index('assets_folder_idx').on(table.folderPath, table.createdAt)],
);

export const assetTags = pgTable(
  'asset_tags',
  { assetId: text('asset_id').notNull(), tag: text('tag').notNull() },
  (table) => [primaryKey({ columns: [table.assetId, table.tag] })],
);

export const assetLineage = pgTable(
  'asset_lineage',
  { childId: text('child_id').notNull(), parentId: text('parent_id').notNull(), role: text('role') },
  (table) => [primaryKey({ columns: [table.childId, table.parentId] })],
);

export const assetCharacters = pgTable(
  'asset_characters',
  {
    assetId: text('asset_id').notNull(),
    characterId: text('character_id').notNull(),
    version: integer('version').notNull(),
    strategy: text('strategy').notNull(),
  },
  (table) => [primaryKey({ columns: [table.assetId, table.characterId] })],
);

export const smartFolders = pgTable('smart_folders', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  filters: jsonb('filters').$type<Record<string, unknown>>().notNull(),
  position: integer('position'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

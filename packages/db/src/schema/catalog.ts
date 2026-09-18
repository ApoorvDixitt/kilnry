// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { boolean, jsonb, numeric, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

const updatedAt = () => timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();
export const presets = pgTable('presets', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  category: text('category'),
  source: text('source'),
  path: text('path'),
  json: jsonb('json').$type<Record<string, unknown>>().notNull(),
  enabled: boolean('enabled').notNull().default(true),
  indicativeCostUsd: numeric('indicative_cost_usd', { precision: 12, scale: 6 }),
  updatedAt: updatedAt(),
});
export const workflows = pgTable('workflows', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  version: text('version'),
  source: text('source'),
  path: text('path'),
  yaml: text('yaml').notNull(),
  inputsSchema: jsonb('inputs_schema').$type<Record<string, unknown>>(),
  costRange: jsonb('cost_range').$type<Record<string, unknown>>(),
  enabled: boolean('enabled').notNull().default(true),
  updatedAt: updatedAt(),
});
export const skills = pgTable('skills', {
  name: text('name').primaryKey(),
  description: text('description'),
  license: text('license'),
  source: text('source'),
  path: text('path'),
  frontmatter: jsonb('frontmatter').$type<Record<string, unknown>>(),
  enabled: boolean('enabled').notNull().default(true),
  updatedAt: updatedAt(),
});

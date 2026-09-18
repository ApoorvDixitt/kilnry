// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { jsonb, numeric, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const chatSessions = pgTable('chat_sessions', {
  id: text('id').primaryKey(),
  title: text('title'),
  folder: text('folder'),
  llmProvider: text('llm_provider'),
  llmModel: text('llm_model'),
  autonomy: text('autonomy').notNull().default('ask_first'),
  budgetUsd: numeric('budget_usd', { precision: 12, scale: 6 }),
  spentUsd: numeric('spent_usd', { precision: 12, scale: 6 }).notNull().default('0'),
  autoApproveBelowUsd: numeric('auto_approve_below_usd', { precision: 12, scale: 6 }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const chatMessages = pgTable('chat_messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  role: text('role').notNull(),
  parts: jsonb('parts').$type<unknown[]>().notNull(),
  usage: jsonb('usage').$type<Record<string, unknown>>(),
  costUsd: numeric('cost_usd', { precision: 12, scale: 6 }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

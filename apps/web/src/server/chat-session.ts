// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The values a new Chat session starts with (F-104, F-115): the workspace's
// autonomy, session budget and auto-approve threshold from Settings › Chat, or
// the canon defaults when nothing is stored — $5.00 a session (PRD-14:173) and
// $0.50 auto-approve (PRD-11 §3). A session row always carries a numeric budget
// and threshold, so "no figure" can never read as "no cap".

import { AUTO_APPROVE_BELOW_USD_DEFAULT, SESSION_BUDGET_USD_DEFAULT } from '@kilnry/agent';
import { chatSessions, settings, type DatabaseState } from '@kilnry/db';
import { eq } from 'drizzle-orm';

export interface ChatSessionDefaults {
  autonomy: 'ask_first' | 'run_automatically';
  budget_usd: number;
  auto_approve_below_usd: number;
}

async function readSetting(database: DatabaseState, key: string): Promise<unknown> {
  const rows = await database.db.select().from(settings).where(eq(settings.key, key)).limit(1);
  return rows[0]?.value;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export async function chatSessionDefaults(database: DatabaseState): Promise<ChatSessionDefaults> {
  const autonomy = await readSetting(database, 'chat.autonomy');
  return {
    autonomy: autonomy === 'run_automatically' ? 'run_automatically' : 'ask_first',
    budget_usd:
      finiteNumber(await readSetting(database, 'chat.session_budget_usd')) ?? SESSION_BUDGET_USD_DEFAULT,
    auto_approve_below_usd:
      finiteNumber(await readSetting(database, 'chat.auto_approve_below_usd')) ??
      AUTO_APPROVE_BELOW_USD_DEFAULT,
  };
}

/** The defaults as chat_sessions column values. */
export function sessionRowDefaults(defaults: ChatSessionDefaults): {
  autonomy: string;
  budgetUsd: string;
  autoApproveBelowUsd: string;
} {
  return {
    autonomy: defaults.autonomy,
    budgetUsd: String(defaults.budget_usd),
    autoApproveBelowUsd: String(defaults.auto_approve_below_usd),
  };
}

/** Create the session row from the defaults unless it already exists. */
export async function ensureChatSession(database: DatabaseState, id: string): Promise<void> {
  const defaults = await chatSessionDefaults(database);
  await database.db
    .insert(chatSessions)
    .values({ id, ...sessionRowDefaults(defaults) })
    .onConflictDoNothing({ target: chatSessions.id });
}

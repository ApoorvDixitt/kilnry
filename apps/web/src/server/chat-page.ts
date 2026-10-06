// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// What the Chat page needs before it renders: the language models the user can
// actually use, the saved default, the session's own settings, and — since
// F-116 — the messages already persisted for that session, so a reload shows
// the same conversation with the same cards instead of an empty thread
// (PRD-11:155 "Cards are persisted in chat_messages.parts").

import {
  AUTO_APPROVE_BELOW_USD_DEFAULT,
  listChatModels,
  type LlmProvider,
  type LlmRegistryRow,
} from '@kilnry/agent';
import { loadRegistry } from '@kilnry/core';
import { chatMessages, chatSessions, settings } from '@kilnry/db';
import { detectOllama } from '@kilnry/providers';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import type { ChatModelOption, ChatScreenProps } from '../components/chat-screen';
import { runtimeServices } from './runtime';

const LLM_PROVIDERS: LlmProvider[] = ['openrouter', 'anthropic', 'openai', 'google'];

/** The id of the session the bare /chat route should open (PRD-11:17). */
export async function latestChatSessionId(): Promise<string | undefined> {
  const services = await runtimeServices();
  const rows = await services.database.db
    .select({ id: chatSessions.id })
    .from(chatSessions)
    .orderBy(desc(chatSessions.updatedAt))
    .limit(1);
  return rows[0]?.id;
}

export function newChatSessionId(): string {
  return `session-${Date.now().toString(36)}`;
}

export async function chatScreenProps(sessionId: string): Promise<ChatScreenProps> {
  const services = await runtimeServices();
  const registry = await loadRegistry(services.database);
  const rows: LlmRegistryRow[] = registry.models.map((model) => ({
    provider: model.provider,
    model_id: model.model_id,
    capabilities: model.capabilities,
    price_rule: model.price_rule as LlmRegistryRow['price_rule'],
  }));

  const connected: LlmProvider[] = [];
  for (const provider of LLM_PROVIDERS) {
    const key = await services.keyStore.get(provider as never).catch(() => undefined);
    if (key) connected.push(provider);
  }

  const stored = await readChatSettings(services);
  const ollama = await detectOllama(
    typeof stored['chat.ollama_base_url'] === 'string'
      ? { base_url: stored['chat.ollama_base_url'] as string }
      : {},
  );

  const models: ChatModelOption[] = listChatModels(rows, connected).map((entry) => ({
    provider: entry.ref.provider,
    model: entry.ref.model,
    price_label: entry.price_label,
  }));
  for (const model of ollama.models) {
    if (model.tools) models.push({ provider: 'ollama', model: model.name, price_label: 'free' });
  }

  // The session's own row wins over the workspace defaults; a session that has
  // not been created yet falls back to them.
  const sessionRow = (
    await services.database.db.select().from(chatSessions).where(eq(chatSessions.id, sessionId)).limit(1)
  )[0];
  const messageRows = await services.database.db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId))
    .orderBy(asc(chatMessages.createdAt));

  const defaultLlm =
    sessionRow?.llmProvider && sessionRow.llmModel
      ? { provider: sessionRow.llmProvider, model: sessionRow.llmModel }
      : stored['chat.default_llm'];
  const budget =
    sessionRow?.budgetUsd === null || sessionRow?.budgetUsd === undefined
      ? stored['chat.session_budget_usd']
      : Number(sessionRow.budgetUsd);
  const autonomy = sessionRow?.autonomy ?? stored['chat.autonomy'];

  return {
    sessionId,
    models,
    ollamaDetected: ollama.detected,
    autoApproveUsd:
      sessionRow?.autoApproveBelowUsd === null || sessionRow?.autoApproveBelowUsd === undefined
        ? AUTO_APPROVE_BELOW_USD_DEFAULT
        : Number(sessionRow.autoApproveBelowUsd),
    ...(isRef(defaultLlm) ? { defaultModel: defaultLlm } : {}),
    sessionAutonomy:
      autonomy === 'run_automatically' ? ('run_automatically' as const) : ('ask_first' as const),
    ...(typeof budget === 'number' ? { sessionBudgetUsd: budget } : {}),
    initialMessages: messageRows.map((row) => ({
      id: row.id,
      role: row.role as 'user' | 'assistant' | 'system',
      parts: (row.parts ?? []) as ChatScreenProps['initialMessages'] extends Array<infer M>
        ? M extends { parts: infer P }
          ? P
          : never
        : never,
    })) as NonNullable<ChatScreenProps['initialMessages']>,
  };
}

function isRef(value: unknown): value is { provider: string; model: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { provider?: unknown }).provider === 'string' &&
    typeof (value as { model?: unknown }).model === 'string'
  );
}

async function readChatSettings(
  services: Awaited<ReturnType<typeof runtimeServices>>,
): Promise<Record<string, unknown>> {
  const keys = ['chat.default_llm', 'chat.autonomy', 'chat.session_budget_usd', 'chat.ollama_base_url'];
  const rows = await services.database.db.select().from(settings).where(inArray(settings.key, keys));
  const out: Record<string, unknown> = {};
  for (const row of rows) out[row.key] = row.value;
  return out;
}

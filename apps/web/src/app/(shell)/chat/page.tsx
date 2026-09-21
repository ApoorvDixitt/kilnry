// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The /chat route (F-CHT-04). The server picks up which language models the user
// can actually use, the saved default and the session budget, then hands them to
// the split-pane screen. A fresh session id per visit keeps one thread per tab
// until session history arrives with its own feature.

import { listChatModels, type LlmProvider, type LlmRegistryRow } from '@kilnry/agent';
import { loadRegistry } from '@kilnry/core';
import { settings } from '@kilnry/db';
import { detectOllama } from '@kilnry/providers';
import { inArray } from 'drizzle-orm';
import { ChatScreen, type ChatModelOption } from '../../../components/chat-screen';
import { runtimeServices } from '../../../server/runtime';

const LLM_PROVIDERS: LlmProvider[] = ['openrouter', 'anthropic', 'openai', 'google'];

export default async function ChatPage(): Promise<React.ReactNode> {
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

  const defaultLlm = stored['chat.default_llm'];
  const budget = stored['chat.session_budget_usd'];

  return (
    <ChatScreen
      sessionId={`session-${Date.now().toString(36)}`}
      models={models}
      ollamaDetected={ollama.detected}
      {...(isRef(defaultLlm) ? { defaultModel: defaultLlm } : {})}
      {...(typeof budget === 'number' ? { sessionBudgetUsd: budget } : {})}
    />
  );
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
  const keys = ['chat.default_llm', 'chat.session_budget_usd', 'chat.ollama_base_url'];
  const rows = await services.database.db.select().from(settings).where(inArray(settings.key, keys));
  const out: Record<string, unknown> = {};
  for (const row of rows) out[row.key] = row.value;
  return out;
}

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Settings › Chat (F-SET-05). Reads the language models the user can actually
// use — every connected provider's models with their per-million token prices
// from the registry, plus a local Ollama model when one is detected — and saves
// the default model, the autonomy mode, the session budget and the Ollama URL.
// Nothing here spends: it lists what is available and stores a preference.

import { NextResponse } from 'next/server';
import * as z from 'zod';
import {
  defaultLlmRef,
  formatLlmPrice,
  listChatModels,
  type LlmProvider,
  type LlmRegistryRow,
} from '@kilnry/agent';
import { loadRegistry } from '@kilnry/core';
import { SESSION_BUDGET_USD_DEFAULT } from '@kilnry/agent';
import { settings } from '@kilnry/db';
import { detectOllama } from '@kilnry/providers';
import { eq } from 'drizzle-orm';
import { errorResponse, requireSession } from '../../../../server/http';
import { runtimeServices } from '../../../../server/runtime';

const CHAT_KEYS = [
  'chat.default_llm',
  'chat.autonomy',
  'chat.session_budget_usd',
  'chat.ollama_base_url',
] as const;

const Input = z.object({
  default_llm: z.object({ provider: z.string(), model: z.string() }).nullable().optional(),
  autonomy: z.enum(['ask_first', 'run_automatically']).optional(),
  session_budget_usd: z.number().min(0).max(10_000).nullable().optional(),
  ollama_base_url: z.string().max(200).optional(),
});

// The providers that can serve Chat, in the order Settings lists them.
const LLM_PROVIDERS: LlmProvider[] = ['openrouter', 'anthropic', 'openai', 'google'];

export async function GET(): Promise<Response> {
  try {
    await requireSession();
    const services = await runtimeServices();
    const stored = await readChatSettings();

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

    const ollamaBaseUrl =
      typeof stored['chat.ollama_base_url'] === 'string'
        ? (stored['chat.ollama_base_url'] as string)
        : undefined;
    const ollama = await detectOllama(ollamaBaseUrl ? { base_url: ollamaBaseUrl } : {});

    // The registry's display name for each model, so Settings › Chat reads
    // names, not ids (UX-08).
    const names = new Map(
      registry.models.map((model) => [`${model.provider}:${model.model_id}`, model.display_name]),
    );
    const models: Array<{
      provider: string;
      model: string;
      display_name?: string;
      price_label: string;
      vision: boolean;
    }> = listChatModels(rows, connected).map((entry) => {
      const display = names.get(`${entry.ref.provider}:${entry.ref.model}`);
      return {
        provider: entry.ref.provider,
        model: entry.ref.model,
        ...(display ? { display_name: display } : {}),
        price_label: entry.price_label,
        vision: entry.vision,
      };
    });
    for (const model of ollama.models) {
      if (!model.tools) continue;
      models.push({
        provider: 'ollama',
        model: model.name,
        price_label: formatLlmPrice({ in: 0, out: 0 }),
        vision: model.vision,
      });
    }

    const fallback = defaultLlmRef({
      connected,
      ollamaModels: ollama.models.filter((model) => model.tools).map((model) => model.name),
    });

    return NextResponse.json({
      chat: {
        default_llm: stored['chat.default_llm'] ?? fallback ?? null,
        autonomy: stored['chat.autonomy'] ?? 'ask_first',
        // An unset budget is the $5.00 default, never "no cap" (F-104).
        session_budget_usd:
          typeof stored['chat.session_budget_usd'] === 'number'
            ? stored['chat.session_budget_usd']
            : SESSION_BUDGET_USD_DEFAULT,
        ollama_base_url: ollamaBaseUrl ?? ollama.base_url,
      },
      models,
      ollama: { detected: ollama.detected, base_url: ollama.base_url, models: ollama.models.length },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    await requireSession();
    const input = Input.parse(await request.json());
    const services = await runtimeServices();
    const writes: Array<[string, unknown]> = [];
    // A null value clears the setting back to its default; settings.value is
    // NOT NULL, so writing a null failed the whole save with a 500 (F-121).
    const clears: string[] = [];
    if (input.default_llm !== undefined) {
      if (input.default_llm === null) clears.push('chat.default_llm');
      else writes.push(['chat.default_llm', input.default_llm]);
    }
    if (input.autonomy !== undefined) writes.push(['chat.autonomy', input.autonomy]);
    if (input.session_budget_usd !== undefined) {
      if (input.session_budget_usd === null) clears.push('chat.session_budget_usd');
      else writes.push(['chat.session_budget_usd', input.session_budget_usd]);
    }
    if (input.ollama_base_url !== undefined) writes.push(['chat.ollama_base_url', input.ollama_base_url]);

    await services.database.db.transaction(async (transaction) => {
      for (const key of clears) await transaction.delete(settings).where(eq(settings.key, key));
      for (const [key, value] of writes) {
        await transaction
          .insert(settings)
          .values({ key, value })
          .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
      }
    });
    return NextResponse.json({
      chat: { ...Object.fromEntries(clears.map((key) => [key, null])), ...Object.fromEntries(writes) },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

async function readChatSettings(): Promise<Record<string, unknown>> {
  const services = await runtimeServices();
  const out: Record<string, unknown> = {};
  for (const key of CHAT_KEYS) {
    const rows = await services.database.db.select().from(settings).where(eq(settings.key, key)).limit(1);
    const row = rows[0];
    if (row) out[key] = row.value;
  }
  return out;
}

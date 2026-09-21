// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Chat model resolution (F-CHT-01, TRD-11 §2). The user brings their own large
// language model (LLM) key: OpenRouter is the default route, Anthropic, OpenAI
// and Google can be used directly, and a local Ollama model runs for free. This
// module turns a stored reference like { provider: 'openrouter', model:
// 'anthropic/claude-sonnet-5' } into the AI SDK language model to call, the
// per-million-token price to show and meter with, and the capabilities the rest
// of the runtime branches on (vision for image attachments, tool calling, and
// the context window).
//
// Nothing here spends money: resolution reads the key store and the model
// registry only. The price comes from the registry's price snapshot so Chat
// tokens are billed and shown exactly like every other spend.

import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { LanguageModel } from 'ai';
import { createOllama } from 'ai-sdk-ollama';

/** The five ways Chat can reach a language model (TRD-11 §2). */
export type LlmProvider = 'openrouter' | 'anthropic' | 'openai' | 'google' | 'ollama';

/** A stored choice of model: which route, and which model on it. */
export interface LlmRef {
  provider: LlmProvider;
  model: string;
}

/** Token price in United States dollars per million tokens. */
export interface LlmPrice {
  in: number;
  out: number;
  cached_in?: number;
}

/** What the runtime needs to know about the model's abilities. */
export interface LlmCaps {
  vision: boolean;
  tools: boolean;
  context: number;
}

export interface ResolvedLlm {
  model: LanguageModel;
  ref: LlmRef;
  price: LlmPrice;
  caps: LlmCaps;
  /** True for a local Ollama model: the offline prompt addendum applies. */
  local: boolean;
}

/** Raised when a model cannot be used, with a message the user can act on. */
export class ModelResolutionError extends Error {
  readonly code: 'NO_PROVIDER' | 'INVALID_INPUT';
  constructor(code: 'NO_PROVIDER' | 'INVALID_INPUT', message: string) {
    super(message);
    this.name = 'ModelResolutionError';
    this.code = code;
  }
}

/** The default route when an OpenRouter key exists (PRD-16 §5). */
export const DEFAULT_LLM: LlmRef = { provider: 'openrouter', model: 'anthropic/claude-sonnet-5' };

/** Local models known to support tool calling, named in the Ollama error. */
export const OLLAMA_TOOL_MODELS = ['qwen3:8b', 'qwen3:30b-a3b', 'gemma3:12b'] as const;

const OPENROUTER_HEADERS = { 'HTTP-Referer': 'https://kilnry.app', 'X-Title': 'Kilnry' };

/** A registry row reduced to what price and capability lookup needs. */
export interface LlmRegistryRow {
  provider: string;
  model_id: string;
  capabilities: string[];
  price_rule: { kind: string; in?: number; out?: number; cached_in?: number };
  supports?: { context?: number };
}

/**
 * Read the per-million token price for a model from the registry rows. Returns
 * undefined when the registry has no per-million rule for it, which the caller
 * reports rather than guessing a price (the base prompt forbids guessing).
 */
export function llmPrice(rows: LlmRegistryRow[], ref: LlmRef): LlmPrice | undefined {
  const row = rows.find((r) => r.provider === ref.provider && r.model_id === ref.model);
  if (!row || row.price_rule.kind !== 'per_million_tokens') return undefined;
  const { in: tokensIn, out: tokensOut, cached_in: cachedIn } = row.price_rule;
  if (typeof tokensIn !== 'number' || typeof tokensOut !== 'number') return undefined;
  return { in: tokensIn, out: tokensOut, ...(typeof cachedIn === 'number' ? { cached_in: cachedIn } : {}) };
}

/** Capabilities for a registry row: vision when it also serves the vlm capability. */
export function llmCaps(rows: LlmRegistryRow[], ref: LlmRef, fallbackContext = 200_000): LlmCaps {
  const row = rows.find((r) => r.provider === ref.provider && r.model_id === ref.model);
  return {
    vision: row ? row.capabilities.includes('vlm') : false,
    tools: true,
    context: row?.supports?.context ?? fallbackContext,
  };
}

/** Render a price as the "$2 / $10 per M" chip the Chat header and Settings show. */
export function formatLlmPrice(price: LlmPrice | undefined): string {
  if (!price) return 'price unavailable';
  if (price.in === 0 && price.out === 0) return 'free';
  const money = (usd: number): string => (Number.isInteger(usd) ? `$${usd}` : `$${usd.toFixed(2)}`);
  return `${money(price.in)} / ${money(price.out)} per M`;
}

/**
 * Pick the default model for a new session (PRD-16 §5): OpenRouter's Claude
 * Sonnet when an OpenRouter key exists, else the first connected direct
 * provider, else a local Ollama model when one is detected.
 */
export function defaultLlmRef(input: {
  connected: LlmProvider[];
  ollamaModels?: string[];
}): LlmRef | undefined {
  if (input.connected.includes('openrouter')) return DEFAULT_LLM;
  for (const provider of ['anthropic', 'openai', 'google'] as const) {
    if (input.connected.includes(provider)) return { provider, model: directDefaultModel(provider) };
  }
  const local = input.ollamaModels?.[0];
  if (local) return { provider: 'ollama', model: local };
  return undefined;
}

function directDefaultModel(provider: 'anthropic' | 'openai' | 'google'): string {
  switch (provider) {
    case 'anthropic':
      return 'claude-sonnet-5';
    case 'openai':
      return 'gpt-5.6-terra';
    case 'google':
      return 'gemini-3.8-flash';
  }
}

export interface ResolveModelInput {
  ref: LlmRef;
  /** Reads the decrypted provider key; returns undefined when not connected. */
  getKey: (provider: LlmProvider) => Promise<string | undefined>;
  /** Registry rows for price and capability lookup. */
  rows: LlmRegistryRow[];
  /** Base URL for the local Ollama server, when it is not the default. */
  ollamaBaseUrl?: string;
  /** Probes a local model's capabilities and context window. */
  ollamaShow?: (
    baseUrl: string,
    model: string,
  ) => Promise<{ capabilities: string[]; num_ctx?: number } | undefined>;
}

/**
 * Resolve a stored model reference into the language model to call, its price
 * and its capabilities (TRD-11 §2). Throws ModelResolutionError with a message
 * naming what the user must do when the key is missing or a local model cannot
 * call tools.
 */
export async function resolveModel(input: ResolveModelInput): Promise<ResolvedLlm> {
  const { ref, rows } = input;

  if (ref.provider === 'ollama') {
    const baseUrl = input.ollamaBaseUrl ?? 'http://127.0.0.1:11434';
    const show = await input.ollamaShow?.(baseUrl, ref.model);
    if (show && !show.capabilities.includes('tools')) {
      throw new ModelResolutionError(
        'INVALID_INPUT',
        `${ref.model} does not support tool calling, which Chat needs. Pick ${OLLAMA_TOOL_MODELS.join(', ')}.`,
      );
    }
    const context = show?.num_ctx ?? 32_768;
    const ollama = createOllama({ baseURL: `${baseUrl}/api` });
    return {
      model: ollama(ref.model, { options: { num_ctx: Math.min(context, 65_536) } }),
      ref,
      price: { in: 0, out: 0 },
      caps: { vision: show?.capabilities.includes('vision') ?? false, tools: true, context },
      local: true,
    };
  }

  const key = await input.getKey(ref.provider);
  if (!key) {
    throw new ModelResolutionError(
      'NO_PROVIDER',
      `No ${providerLabel(ref.provider)} key is connected. Add one in Settings › Providers to chat with ${ref.model}.`,
    );
  }

  const price = llmPrice(rows, ref) ?? { in: 0, out: 0 };
  const caps = llmCaps(rows, ref);

  switch (ref.provider) {
    case 'openrouter': {
      const openrouter = createOpenRouter({ apiKey: key, headers: OPENROUTER_HEADERS });
      return {
        model: openrouter.chat(ref.model, { usage: { include: true } }),
        ref,
        price,
        caps,
        local: false,
      };
    }
    case 'anthropic':
      return { model: createAnthropic({ apiKey: key })(ref.model), ref, price, caps, local: false };
    case 'openai':
      return { model: createOpenAI({ apiKey: key })(ref.model), ref, price, caps, local: false };
    case 'google':
      return { model: createGoogleGenerativeAI({ apiKey: key })(ref.model), ref, price, caps, local: false };
  }
}

function providerLabel(provider: LlmProvider): string {
  switch (provider) {
    case 'openrouter':
      return 'OpenRouter';
    case 'anthropic':
      return 'Anthropic';
    case 'openai':
      return 'OpenAI';
    case 'google':
      return 'Google';
    case 'ollama':
      return 'Ollama';
  }
}

/**
 * Turn a token count and a price into dollars, the arithmetic the Chat header,
 * the Cost tab and the spend ledger all use (TRD-11 §9). Reasoning tokens are
 * billed at the output rate.
 */
export function tokensToUsd(
  usage: {
    inputTokens?: number | undefined;
    outputTokens?: number | undefined;
    cachedInputTokens?: number | undefined;
    reasoningTokens?: number | undefined;
  },
  price: LlmPrice,
): number {
  const million = 1_000_000;
  const cached = usage.cachedInputTokens ?? 0;
  const fresh = Math.max((usage.inputTokens ?? 0) - cached, 0);
  const out = (usage.outputTokens ?? 0) + (usage.reasoningTokens ?? 0);
  const cachedRate = price.cached_in ?? price.in;
  return (fresh * price.in + cached * cachedRate + out * price.out) / million;
}

/** The models Settings › Chat lists, with the price chip for each (F-SET-05). */
export function listChatModels(
  rows: LlmRegistryRow[],
  connected: LlmProvider[],
): Array<{ ref: LlmRef; price: LlmPrice; price_label: string; vision: boolean }> {
  return rows
    .filter((row) => row.capabilities.includes('llm') && row.price_rule.kind === 'per_million_tokens')
    .filter((row) => connected.includes(row.provider as LlmProvider))
    .map((row) => {
      const ref: LlmRef = { provider: row.provider as LlmProvider, model: row.model_id };
      const price = llmPrice(rows, ref) ?? { in: 0, out: 0 };
      return { ref, price, price_label: formatLlmPrice(price), vision: row.capabilities.includes('vlm') };
    })
    .sort((a, b) => a.price.in - b.price.in || a.ref.model.localeCompare(b.ref.model));
}

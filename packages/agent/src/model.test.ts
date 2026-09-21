// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import {
  defaultLlmRef,
  DEFAULT_LLM,
  formatLlmPrice,
  llmCaps,
  llmPrice,
  listChatModels,
  ModelResolutionError,
  resolveModel,
  tokensToUsd,
  type LlmRegistryRow,
} from './model.js';

// A small slice of the registry in the shape the store returns.
const rows: LlmRegistryRow[] = [
  {
    provider: 'openrouter',
    model_id: 'anthropic/claude-sonnet-5',
    capabilities: ['llm', 'vlm'],
    price_rule: { kind: 'per_million_tokens', in: 2, out: 10 },
  },
  {
    provider: 'openrouter',
    model_id: 'openai/gpt-5.6-luna',
    capabilities: ['llm', 'vlm'],
    price_rule: { kind: 'per_million_tokens', in: 0.2, out: 1.2 },
  },
  {
    provider: 'openrouter',
    model_id: 'kilnry/text-only',
    capabilities: ['llm'],
    price_rule: { kind: 'per_million_tokens', in: 1, out: 3 },
  },
  {
    provider: 'openrouter',
    model_id: 'some/image-model',
    capabilities: ['text2image'],
    price_rule: { kind: 'per_image' },
  },
];

describe('per-million pricing (F-CHT-01)', () => {
  it('reads the price for a model from the registry', () => {
    expect(llmPrice(rows, { provider: 'openrouter', model: 'anthropic/claude-sonnet-5' })).toEqual({
      in: 2,
      out: 10,
    });
  });

  it('returns no price rather than guessing when the rule is not per-million', () => {
    expect(llmPrice(rows, { provider: 'openrouter', model: 'some/image-model' })).toBeUndefined();
    expect(llmPrice(rows, { provider: 'openai', model: 'nope' })).toBeUndefined();
  });

  it('renders the price chip shown in Chat and Settings', () => {
    expect(formatLlmPrice({ in: 2, out: 10 })).toBe('$2 / $10 per M');
    expect(formatLlmPrice({ in: 0.25, out: 1.5 })).toBe('$0.25 / $1.50 per M');
    expect(formatLlmPrice({ in: 0, out: 0 })).toBe('free');
    expect(formatLlmPrice(undefined)).toBe('price unavailable');
  });

  it('marks vision from the vision-language capability', () => {
    expect(llmCaps(rows, { provider: 'openrouter', model: 'anthropic/claude-sonnet-5' }).vision).toBe(true);
    expect(llmCaps(rows, { provider: 'openrouter', model: 'kilnry/text-only' }).vision).toBe(false);
  });

  it('converts token usage to dollars, billing reasoning at the output rate', () => {
    const cost = tokensToUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, { in: 2, out: 10 });
    expect(cost).toBeCloseTo(12, 6);
    const reasoning = tokensToUsd(
      { inputTokens: 0, outputTokens: 0, reasoningTokens: 500_000 },
      { in: 2, out: 10 },
    );
    expect(reasoning).toBeCloseTo(5, 6);
  });

  it('bills cached input at the cached rate when the model has one', () => {
    const cost = tokensToUsd(
      { inputTokens: 1_000_000, cachedInputTokens: 900_000, outputTokens: 0 },
      { in: 2, out: 10, cached_in: 0.2 },
    );
    // 100k fresh at $2/M plus 900k cached at $0.20/M.
    expect(cost).toBeCloseTo(0.2 + 0.18, 6);
  });

  it('lists only connected models that have a per-million price, cheapest first', () => {
    const listed = listChatModels(rows, ['openrouter']);
    expect(listed.map((entry) => entry.ref.model)).toEqual([
      'openai/gpt-5.6-luna',
      'kilnry/text-only',
      'anthropic/claude-sonnet-5',
    ]);
    expect(listed[0]?.price_label).toBe('$0.20 / $1.20 per M');
  });
});

describe('default model choice (PRD-16 §5)', () => {
  it('prefers OpenRouter Claude Sonnet when an OpenRouter key exists', () => {
    expect(defaultLlmRef({ connected: ['openrouter', 'openai'] })).toEqual(DEFAULT_LLM);
  });

  it('falls back to the first connected direct provider', () => {
    expect(defaultLlmRef({ connected: ['openai', 'google'] })).toEqual({
      provider: 'openai',
      model: 'gpt-5.6-terra',
    });
  });

  it('falls back to a detected local model, then to nothing', () => {
    expect(defaultLlmRef({ connected: [], ollamaModels: ['qwen3:8b'] })).toEqual({
      provider: 'ollama',
      model: 'qwen3:8b',
    });
    expect(defaultLlmRef({ connected: [] })).toBeUndefined();
  });
});

describe('resolveModel (TRD-11 §2)', () => {
  const getKey = async (provider: string): Promise<string | undefined> =>
    provider === 'openrouter' ? 'sk-or-v1-test' : undefined;

  it('resolves an OpenRouter model with its registry price', async () => {
    const resolved = await resolveModel({
      ref: { provider: 'openrouter', model: 'anthropic/claude-sonnet-5' },
      getKey,
      rows,
    });
    expect(resolved.price).toEqual({ in: 2, out: 10 });
    expect(resolved.local).toBe(false);
    expect(resolved.caps.vision).toBe(true);
    expect(resolved.model).toBeDefined();
  });

  it('refuses a provider with no key and names the screen to fix it', async () => {
    await expect(
      resolveModel({ ref: { provider: 'anthropic', model: 'claude-sonnet-5' }, getKey, rows }),
    ).rejects.toThrow(/No Anthropic key is connected/);
    await expect(
      resolveModel({ ref: { provider: 'anthropic', model: 'claude-sonnet-5' }, getKey, rows }),
    ).rejects.toBeInstanceOf(ModelResolutionError);
  });

  it('resolves a local model as free and offline', async () => {
    const resolved = await resolveModel({
      ref: { provider: 'ollama', model: 'qwen3:8b' },
      getKey,
      rows,
      ollamaShow: async () => ({ capabilities: ['tools', 'vision'], num_ctx: 32_768 }),
    });
    expect(resolved.price).toEqual({ in: 0, out: 0 });
    expect(resolved.local).toBe(true);
    expect(resolved.caps.vision).toBe(true);
    expect(resolved.caps.context).toBe(32_768);
  });

  it('refuses a local model that cannot call tools and names ones that can', async () => {
    await expect(
      resolveModel({
        ref: { provider: 'ollama', model: 'llama-no-tools' },
        getKey,
        rows,
        ollamaShow: async () => ({ capabilities: ['vision'] }),
      }),
    ).rejects.toThrow(/does not support tool calling.*qwen3:8b/s);
  });
});

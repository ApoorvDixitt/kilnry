// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The Ollama adapter (F-PRV-08). Ollama is a local large-language-model (LLM)
// and vision-language-model (VLM) runtime; it has no key and never bills. Kilnry
// detects it by probing the loopback endpoint GET /api/tags, lists the installed
// models, and reads each model's capabilities from POST /api/show so Chat can
// tell which models support tool calling and which can see images. Detection is
// loopback-only: when Ollama is absent the probe simply reports "not detected"
// and no request ever leaves the machine (the zero-egress rule). This adapter
// generates no images, video, audio or 3D; those capabilities return NO_PROVIDER.

import {
  KilnryError,
  redact,
  type CanonicalRequest,
  type ModelManifest,
  type ProviderAdapter,
  type ProviderResult,
} from '@kilnry/core';
import { providerNetworkError } from '../errors.js';
import { requestJson } from '../http.js';

// The default loopback base. Settings › Chat (F-SET-05) may override it; callers
// pass the configured value through the options.base_url argument.
export const OLLAMA_DEFAULT_BASE_URL = 'http://127.0.0.1:11434';

interface TagsResponse {
  models?: Array<{
    name?: string;
    model?: string;
    size?: number;
    details?: { parameter_size?: string; quantization_level?: string; family?: string };
  }>;
}

interface ShowResponse {
  capabilities?: string[];
  model_info?: Record<string, unknown>;
  details?: { family?: string; parameter_size?: string };
}

interface ChatResponse {
  message?: { role?: string; content?: string; tool_calls?: unknown[] };
  done?: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

// A single detected model with the facts the Providers card and Chat show.
export interface OllamaModel {
  name: string;
  size_bytes: number | null;
  parameter_size: string | null;
  context_length: number | null;
  tools: boolean;
  vision: boolean;
}

export interface OllamaDetection {
  detected: boolean;
  base_url: string;
  models: OllamaModel[];
  error?: string;
}

function baseUrlFrom(options?: { base_url?: string }): string {
  return options?.base_url?.trim() || OLLAMA_DEFAULT_BASE_URL;
}

// Read the context length Ollama reports under a family-prefixed key such as
// "qwen3.context_length"; fall back to null when it is not present.
function contextLength(info: Record<string, unknown> | undefined): number | null {
  if (!info) return null;
  for (const [key, value] of Object.entries(info)) {
    if (key.endsWith('.context_length') && typeof value === 'number') return value;
  }
  return null;
}

// Probe the loopback endpoint and, for each installed model, read its
// capabilities. Any network failure (Ollama not running) resolves to
// detected:false with a human message — it never throws and never retries, so an
// absent Ollama costs one refused loopback connection and nothing leaves the
// machine.
export async function detectOllama(options?: {
  base_url?: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}): Promise<OllamaDetection> {
  const base_url = baseUrlFrom(options);
  const fetchImpl = options?.fetch ?? fetch;
  let tags: TagsResponse;
  try {
    tags = await requestJson<TagsResponse>({
      provider: 'ollama',
      fetch: fetchImpl,
      ...(options?.signal ? { signal: options.signal } : {}),
      url: `${base_url}/api/tags`,
      timeoutMs: 4_000,
    });
  } catch {
    return {
      detected: false,
      base_url,
      models: [],
      error: `Ollama not found at ${base_url}. Install from ollama.com to chat offline for free.`,
    };
  }

  const models: OllamaModel[] = [];
  for (const entry of tags.models ?? []) {
    const name = entry.name ?? entry.model;
    if (!name) continue;
    let capabilities: string[] = [];
    let info: Record<string, unknown> | undefined;
    try {
      const show = await requestJson<ShowResponse>({
        provider: 'ollama',
        fetch: fetchImpl,
        ...(options?.signal ? { signal: options.signal } : {}),
        url: `${base_url}/api/show`,
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: name }),
        },
        timeoutMs: 4_000,
      });
      capabilities = show.capabilities ?? [];
      info = show.model_info;
    } catch {
      // A model that cannot be shown is still listed, just without capability
      // badges; the detection stays loopback-only and never throws.
    }
    models.push({
      name,
      size_bytes: typeof entry.size === 'number' ? entry.size : null,
      parameter_size: entry.details?.parameter_size ?? null,
      context_length: contextLength(info),
      tools: capabilities.includes('tools'),
      vision: capabilities.includes('vision'),
    });
  }
  return { detected: true, base_url, models };
}

// Turn a detected model into a registry manifest: local, free, no retention,
// llm plus vlm when the model can see images.
function manifestFor(model: OllamaModel): ModelManifest {
  const now = new Date().toISOString();
  return {
    provider: 'ollama',
    model_id: model.name,
    display_name: model.name,
    capabilities: model.vision ? ['llm', 'vlm'] : ['llm'],
    supports: {
      negative_prompt: false,
      seed: false,
      audio: false,
      references_max: 0,
      lora: false,
      identity_ids: [],
      voice_ids: false,
      elements: false,
      start_end_frame: false,
      multi_shot: false,
      resolutions: [],
      aspect_ratios: ['auto'],
    },
    media_roles: [],
    params_schema: {},
    price_rule: { kind: 'free', unit: 'run' },
    retention_days: null,
    moderation: { http: null, shape: 'none', billed: 'no' },
    quality_tier: 'standard',
    eta_s: 5,
    tags: [
      'local',
      'offline',
      ...(model.tools ? ['tools'] : ['no-tools']),
      ...(model.vision ? ['vision'] : []),
    ],
    training_on_inputs: false,
    enabled: true,
    deprecated_at: null,
    source_url: 'https://github.com/ollama/ollama/blob/main/docs/api.md',
    seeded_at: now,
  };
}

export const ollamaAdapter: ProviderAdapter = {
  id: 'ollama',
  display_name: 'Ollama',
  base_url: OLLAMA_DEFAULT_BASE_URL,
  key_detection: null,
  concurrency: { default: 1, max_known: 1 },
  retention_days: null,
  training_on_inputs: false,
  supports_authoritative_estimate: false,
  idempotency: 'none',
  async testKey(_key, options) {
    const started = performance.now();
    const detection = await detectOllama({
      ...(options?.base_url ? { base_url: options.base_url } : {}),
      ...(options?.fetch ? { fetch: options.fetch } : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
    });
    if (detection.detected) {
      return {
        ok: true,
        latency_ms: Math.round(performance.now() - started),
        model_count: detection.models.length,
      };
    }
    return {
      ok: false,
      error: new KilnryError(
        'NO_PROVIDER',
        detection.error ?? `Ollama is not running at ${detection.base_url}.`,
        { provider: 'ollama', retryable: true },
      ),
    };
  },
  async listModels(_key, options) {
    const detection = await detectOllama({
      ...(options?.fetch ? { fetch: options.fetch } : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
    });
    return detection.models.map((model) => manifestFor(model));
  },
  async submit(request: CanonicalRequest, context) {
    if (request.capability !== 'llm' && request.capability !== 'vlm') {
      throw new KilnryError(
        'NO_PROVIDER',
        'Ollama runs local text and vision models only; it cannot generate images, video or audio. Add a fal or OpenRouter key for that.',
        { provider: 'ollama', retryable: false },
      );
    }
    const model = request.model ?? 'qwen3:8b';
    const payload = {
      model,
      stream: false,
      messages: [{ role: 'user', content: request.prompt }],
      options: { num_ctx: 32_768 },
    };
    let response: ChatResponse;
    try {
      response = await requestJson<ChatResponse>({
        provider: 'ollama',
        fetch: context.fetch,
        signal: context.signal,
        url: `${this.base_url}/api/chat`,
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        timeoutMs: 120_000,
      });
    } catch (error) {
      throw this.normalizeError(error);
    }
    const text = response.message?.content ?? '';
    const result: ProviderResult = {
      outputs: [{ kind: 'text', text, mime: 'text/plain' }],
      billing: { actual_usd: 0, source: 'free' },
      raw_redacted: redact(response),
    };
    return {
      provider: 'ollama',
      model_id: model,
      provider_request_id: `ollama-${crypto.randomUUID()}`,
      submitted_at: new Date().toISOString(),
      inline_result: result,
      payload_redacted: redact(payload),
    };
  },
  poll(handle) {
    if (handle.inline_result) return Promise.resolve({ state: 'completed', result: handle.inline_result });
    return Promise.resolve({
      state: 'failed',
      error: new KilnryError('PROVIDER_ERROR', 'Ollama did not return a reply inline.', {
        provider: 'ollama',
      }),
    });
  },
  cancel() {
    return Promise.resolve({ ok: false, reason: 'Local Ollama replies complete synchronously.' });
  },
  download() {
    // Ollama returns text inline; there are no bytes to download.
    return Promise.resolve([]);
  },
  normalizeError(error) {
    if (error instanceof KilnryError) {
      // A model without a tool template answers "does not support tools".
      if (/does not support tools/i.test(error.message)) {
        return new KilnryError('INVALID_INPUT', 'Pick a model with tool support (qwen3:8b, gemma3:12b…).', {
          provider: 'ollama',
          retryable: false,
          cause: error,
        });
      }
      return error;
    }
    return providerNetworkError('ollama', error, false);
  },
};

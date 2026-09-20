// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The OpenAI adapter (TRD-06 §3.4, carries F-PRV-01). It generates images
// synchronously through the Images API and returns the picture inline as base64
// with OpenAI's token usage so the job engine can reconcile the exact cost. A
// moderation block comes back as HTTP 400 with error.code "moderation_blocked"
// and is reported as a not-charged rejection; when several images are requested
// and OpenAI's output filter silently drops some, the adapter records how many
// were removed. There is no OpenAI video adapter (Sora is retired, D-42).

import {
  KilnryError,
  redact,
  registrySeed,
  type CanonicalRequest,
  type ModelManifest,
  type ProviderAdapter,
  type ProviderOutput,
  type ProviderResult,
} from '@kilnry/core';
import { downloadOutputs } from '../download.js';
import { providerHttpError } from '../errors.js';
import { requestJson } from '../http.js';

const BASE_URL = 'https://api.openai.com/v1';

interface ImagesResponse {
  data?: Array<{ b64_json?: string; url?: string }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    input_tokens_details?: { image_tokens?: number; text_tokens?: number };
  };
}

function headers(key: string): HeadersInit {
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

function sizeFor(request: CanonicalRequest): string {
  const width = request.params.width;
  const height = request.params.height;
  if (typeof width === 'number' && typeof height === 'number') return `${width}x${height}`;
  return 'auto';
}

export const openaiAdapter: ProviderAdapter = {
  id: 'openai',
  display_name: 'OpenAI',
  base_url: BASE_URL,
  key_detection: {
    pattern: /^sk-(proj-|svcacct-)?[A-Za-z0-9_-]{20,}$/,
    confidence: 'high',
    mask: (key) => `${key.slice(0, 6)}••••${key.slice(-4)}`,
  },
  concurrency: { default: 3, max_known: null },
  retention_days: null,
  training_on_inputs: false,
  supports_authoritative_estimate: false,
  idempotency: 'none',
  async testKey(key, options) {
    const started = performance.now();
    try {
      const response = await requestJson<{ data?: unknown[] }>({
        provider: 'openai',
        fetch: options?.fetch ?? fetch,
        ...(options?.signal ? { signal: options.signal } : {}),
        url: `${options?.base_url ?? this.base_url}/models`,
        init: { headers: headers(key) },
        timeoutMs: 8_000,
      });
      return {
        ok: true,
        latency_ms: Math.round(performance.now() - started),
        model_count: response.data?.length ?? 0,
      };
    } catch (error) {
      return { ok: false, error: this.normalizeError(error) };
    }
  },
  listModels(): Promise<ModelManifest[]> {
    return Promise.resolve(registrySeed.filter((model) => model.provider === 'openai'));
  },
  async submit(request, context) {
    const model = request.params.extra?.model;
    if (typeof model !== 'string' || !model)
      throw new KilnryError('INVALID_INPUT', 'An OpenAI model id is required.', { provider: 'openai' });
    if (request.capability !== 'text2image' && request.capability !== 'image_edit')
      throw new KilnryError(
        'NO_PROVIDER',
        'The OpenAI adapter generates images only; it has no video model.',
        { provider: 'openai', retryable: false },
      );

    const payload: Record<string, unknown> = {
      model,
      prompt: request.prompt,
      n: request.count,
      size: sizeFor(request),
    };
    if (typeof request.params.quality === 'string') {
      const openaiQuality =
        request.params.quality === 'draft' ? 'low' : request.params.quality === 'premium' ? 'high' : 'medium';
      payload.quality = openaiQuality;
    }

    let body: ImagesResponse;
    try {
      body = await requestJson<ImagesResponse>({
        provider: 'openai',
        fetch: context.fetch,
        signal: context.signal,
        url: `${this.base_url}/images/generations`,
        init: { method: 'POST', headers: headers(context.key), body: JSON.stringify(payload) },
        timeoutMs: 120_000,
        ambiguousOnNetworkError: true,
      });
    } catch (error) {
      throw this.normalizeError(error);
    }

    const outputs: ProviderOutput[] = (body.data ?? []).flatMap<ProviderOutput>((entry) => {
      if (entry.b64_json) return [{ kind: 'image', base64: entry.b64_json, mime: 'image/png' }];
      if (entry.url) return [{ kind: 'image', url: entry.url, mime: 'image/png' }];
      return [];
    });
    if (outputs.length === 0)
      throw new KilnryError('PROVIDER_ERROR', 'OpenAI returned no image data.', {
        provider: 'openai',
        retryable: true,
      });

    // OpenAI silently drops images its output filter flags; note how many.
    const adjustments: string[] = [];
    if (outputs.length < request.count)
      adjustments.push(
        `${request.count - outputs.length} of ${request.count} images removed by OpenAI's output filter`,
      );

    const usage = body.usage;
    const result: ProviderResult = {
      outputs,
      ...(usage
        ? {
            billing: {
              usage: {
                input_tokens: usage.input_tokens ?? 0,
                output_tokens: usage.output_tokens ?? 0,
                image_tokens: usage.input_tokens_details?.image_tokens ?? 0,
                text_tokens: usage.input_tokens_details?.text_tokens ?? 0,
              },
              source: 'provider_usage',
            },
          }
        : {}),
      raw_redacted: redact(body),
    };
    return {
      provider: 'openai',
      model_id: model,
      provider_request_id: `openai-${crypto.randomUUID()}`,
      submitted_at: new Date().toISOString(),
      inline_result: result,
      payload_redacted: redact({ ...payload, adjustments }),
    };
  },
  poll(handle) {
    if (handle.inline_result) return Promise.resolve({ state: 'completed', result: handle.inline_result });
    return Promise.resolve({
      state: 'failed',
      error: new KilnryError('PROVIDER_ERROR', 'OpenAI image result was not returned inline.', {
        provider: 'openai',
      }),
    });
  },
  cancel() {
    return Promise.resolve({ ok: false, reason: 'OpenAI image calls complete synchronously.' });
  },
  download(result, context) {
    return downloadOutputs('openai', result, context);
  },
  normalizeError(error) {
    if (error instanceof KilnryError) return error;
    if (error instanceof Response) return providerHttpError('openai', error.status, undefined, error.headers);
    return new KilnryError('PROVIDER_ERROR', 'OpenAI returned an unexpected error.', {
      provider: 'openai',
      retryable: true,
      cause: error,
    });
  },
};

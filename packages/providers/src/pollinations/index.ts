// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import {
  KilnryError,
  redact,
  registrySeed,
  type ProviderAdapter,
  type ProviderOutput,
  type ProviderResult,
} from '@kilnry/core';
import { downloadOutputs } from '../download.js';
import { requestJson } from '../http.js';

interface ImageResponse {
  data?: Array<{ b64_json?: string; url?: string; media_type?: string }>;
}

function headers(key: string): HeadersInit {
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

export const pollinationsAdapter: ProviderAdapter = {
  id: 'pollinations',
  display_name: 'Pollinations',
  base_url: 'https://gen.pollinations.ai',
  key_detection: {
    pattern: /^sk_[A-Za-z0-9]{24,64}$/,
    confidence: 'ambiguous',
    mask: (key) => `${key.slice(0, 5)}••••${key.slice(-4)}`,
  },
  concurrency: { default: 2, max_known: null },
  retention_days: null,
  training_on_inputs: false,
  supports_authoritative_estimate: false,
  idempotency: 'none',
  async testKey(key, options) {
    const started = performance.now();
    try {
      const response = await requestJson<{ data?: unknown[] }>({
        provider: 'pollinations',
        fetch: options?.fetch ?? fetch,
        ...(options?.signal ? { signal: options.signal } : {}),
        url: `${options?.base_url ?? this.base_url}/v1/models`,
        init: { headers: headers(key) },
        timeoutMs: 8_000,
      });
      return {
        ok: true,
        latency_ms: Math.round(performance.now() - started),
        model_count: response.data?.length ?? 1,
      };
    } catch (error) {
      return { ok: false, error: this.normalizeError(error) };
    }
  },
  listModels() {
    return Promise.resolve(registrySeed.filter((model) => model.provider === 'pollinations'));
  },
  async submit(request, context) {
    if (request.capability !== 'text2image')
      throw new KilnryError(
        'NO_PROVIDER',
        'Demo covers images only. Add a fal or OpenRouter key for video and audio.',
      );
    const payload = {
      model: 'flux',
      prompt: request.prompt,
      n: request.count,
      ...(request.params.width && request.params.height
        ? { size: `${request.params.width}x${request.params.height}` }
        : {}),
    };
    const response = await requestJson<ImageResponse>({
      provider: 'pollinations',
      fetch: context.fetch,
      signal: context.signal,
      url: `${this.base_url}/v1/images/generations`,
      init: { method: 'POST', headers: headers(context.key), body: JSON.stringify(payload) },
      timeoutMs: 120_000,
      ambiguousOnNetworkError: true,
    });
    const outputs: ProviderOutput[] = (response.data ?? []).flatMap<ProviderOutput>((entry) => {
      if (entry.b64_json)
        return [{ kind: 'image' as const, base64: entry.b64_json, mime: entry.media_type ?? 'image/png' }];
      if (entry.url)
        return [{ kind: 'image' as const, url: entry.url, mime: entry.media_type ?? 'image/png' }];
      return [];
    });
    if (outputs.length === 0)
      throw new KilnryError('PROVIDER_ERROR', 'Pollinations completed without returning image bytes.', {
        provider: 'pollinations',
        retryable: true,
      });
    const result: ProviderResult = {
      outputs,
      billing: { actual_usd: 0, source: 'free' },
      raw_redacted: redact(response),
    };
    return {
      provider: 'pollinations',
      model_id: 'flux',
      provider_request_id: `inline-${crypto.randomUUID()}`,
      submitted_at: new Date().toISOString(),
      inline_result: result,
      payload_redacted: redact(payload),
    };
  },
  poll(handle) {
    if (handle.inline_result) return Promise.resolve({ state: 'completed', result: handle.inline_result });
    return Promise.resolve({
      state: 'failed',
      error: new KilnryError('PROVIDER_ERROR', 'Pollinations image result was not returned inline.', {
        provider: 'pollinations',
      }),
    });
  },
  cancel() {
    return Promise.resolve({ ok: false, reason: 'Pollinations image calls complete synchronously.' });
  },
  download(result, context) {
    return downloadOutputs('pollinations', result, context, headers(context.key));
  },
  normalizeError(error) {
    return error instanceof KilnryError
      ? error
      : new KilnryError('PROVIDER_ERROR', 'Pollinations returned an unexpected error.', {
          provider: 'pollinations',
          retryable: true,
          cause: error,
        });
  },
};

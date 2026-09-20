// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The Replicate adapter (TRD-06 §3.8), training subset only. In this milestone
// Kilnry uses Replicate for one thing: training an identity model (a low-rank
// adaptation, or LoRA) that a Character can generate through later, at roughly
// a dollar and a half (F-CHR-07). It submits a training, then polls the training
// by id until it succeeds and yields the new model version. Image, video and
// audio generation through Replicate are intentionally not available here and
// return a clear message rather than pretending. The key is a Bearer token.

import {
  KilnryError,
  redact,
  type CanonicalRequest,
  type ModelManifest,
  type ProviderAdapter,
  type ProviderResult,
  type SubmitHandle,
} from '@kilnry/core';
import { providerHttpError } from '../errors.js';
import { requestJson } from '../http.js';

const BASE_URL = 'https://api.replicate.com/v1';

interface TrainingResponse {
  id?: string;
  status?: string;
  error?: string;
  output?: { version?: string; weights?: string } | string[];
  urls?: { get?: string; cancel?: string };
}

function headers(key: string): HeadersInit {
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

function isTraining(request: CanonicalRequest): boolean {
  return request.capability === 'train_lora' || request.capability === 'train_identity';
}

function trainingOutput(response: TrainingResponse): { version?: string; weights?: string } {
  if (Array.isArray(response.output)) {
    const first = response.output[0];
    return first ? { weights: first } : {};
  }
  return response.output ?? {};
}

export const replicateAdapter: ProviderAdapter = {
  id: 'replicate',
  display_name: 'Replicate',
  base_url: BASE_URL,
  key_detection: {
    pattern: /^r8_[A-Za-z0-9]{37,40}$/,
    confidence: 'high',
    mask: (key) => `${key.slice(0, 5)}••••${key.slice(-4)}`,
  },
  concurrency: { default: 4, max_known: null },
  retention_days: 0,
  training_on_inputs: false,
  supports_authoritative_estimate: false,
  idempotency: 'none',
  async testKey(key, options) {
    const started = performance.now();
    try {
      await requestJson<{ username?: string }>({
        provider: 'replicate',
        fetch: options?.fetch ?? fetch,
        ...(options?.signal ? { signal: options.signal } : {}),
        url: `${options?.base_url ?? this.base_url}/account`,
        init: { headers: headers(key) },
        timeoutMs: 8_000,
      });
      return { ok: true, latency_ms: Math.round(performance.now() - started) };
    } catch (error) {
      return { ok: false, error: this.normalizeError(error) };
    }
  },
  listModels(): Promise<ModelManifest[]> {
    // Replicate is training-only in this milestone; no generation models are
    // seeded for it, so there is nothing to route to for image, video or audio.
    return Promise.resolve([]);
  },
  async submit(request, context): Promise<SubmitHandle> {
    if (!isTraining(request))
      throw new KilnryError(
        'NO_PROVIDER',
        'Replicate is available for identity training only in this version; use fal, OpenRouter or Google to generate.',
        { provider: 'replicate', retryable: false },
      );
    // The training model is given as "owner/name/version" in params.extra.model.
    const model = request.params.extra?.model;
    if (typeof model !== 'string' || model.split('/').length < 3)
      throw new KilnryError(
        'INVALID_INPUT',
        'Replicate training needs a model reference of the form owner/name/version.',
        { provider: 'replicate' },
      );
    const [owner, name, version] = model.split('/');
    const trainingInput = (request.params.extra?.training_input as Record<string, unknown>) ?? {};
    const payload = { destination: `${owner}/${name}-kilnry`, input: trainingInput };
    const response = await requestJson<TrainingResponse>({
      provider: 'replicate',
      fetch: context.fetch,
      signal: context.signal,
      url: `${this.base_url}/models/${owner}/${name}/versions/${version}/trainings`,
      init: { method: 'POST', headers: headers(context.key), body: JSON.stringify(payload) },
      timeoutMs: 30_000,
      ambiguousOnNetworkError: true,
    });
    if (!response.id)
      throw new KilnryError('PROVIDER_ERROR', 'Replicate accepted the training without an id.', {
        provider: 'replicate',
        retryable: true,
      });
    return {
      provider: 'replicate',
      model_id: model,
      provider_request_id: response.id,
      status_url: response.urls?.get ?? `${this.base_url}/trainings/${response.id}`,
      ...(response.urls?.cancel ? { cancel_url: response.urls.cancel } : {}),
      submitted_at: new Date().toISOString(),
      payload_redacted: redact(payload),
    };
  },
  async poll(handle, context) {
    if (!handle.status_url)
      throw new KilnryError('PROVIDER_ERROR', 'Replicate training has no status URL.', {
        provider: 'replicate',
      });
    const training = await requestJson<TrainingResponse>({
      provider: 'replicate',
      fetch: context.fetch,
      signal: context.signal,
      url: handle.status_url,
      init: { headers: headers(context.key) },
    });
    const state = training.status?.toLowerCase();
    if (state === 'starting') return { state: 'queued' };
    if (state === 'processing') return { state: 'running', step_label: 'Training at Replicate' };
    if (state === 'canceled') return { state: 'cancelled' };
    if (state === 'failed') {
      const message = training.error ?? '';
      if (/nsfw|e005|sensitive content|safety/i.test(message))
        return {
          state: 'moderated',
          billed: 'maybe',
          error: new KilnryError('MODERATION_REJECTED', `Replicate rejected the training. ${message}`, {
            provider: 'replicate',
            retryable: false,
            details: { billed: 'maybe' },
          }),
        };
      return {
        state: 'failed',
        error: new KilnryError('PROVIDER_ERROR', `Replicate training failed. ${message}`, {
          provider: 'replicate',
          retryable: true,
        }),
      };
    }
    if (state !== 'succeeded') return { state: 'running', step_label: 'Training at Replicate' };
    const output = trainingOutput(training);
    const result: ProviderResult = {
      outputs: [
        {
          kind: 'json',
          json: { version: output.version, weights: output.weights },
          mime: 'application/json',
        },
      ],
      raw_redacted: redact(training),
    };
    return { state: 'completed', result };
  },
  async cancel(handle, context) {
    if (!handle.cancel_url) return { ok: false, reason: 'Replicate did not return a cancel URL.' };
    await requestJson<Record<string, unknown>>({
      provider: 'replicate',
      fetch: context.fetch,
      signal: context.signal,
      url: handle.cancel_url,
      init: { method: 'POST', headers: headers(context.key) },
    }).catch(() => undefined);
    return { ok: true };
  },
  download() {
    // A training produces a model version, not files to place in the Library.
    return Promise.resolve([]);
  },
  normalizeError(error) {
    if (error instanceof KilnryError) return error;
    if (error instanceof Response)
      return providerHttpError('replicate', error.status, undefined, error.headers);
    return new KilnryError('PROVIDER_ERROR', 'Replicate returned an unexpected error.', {
      provider: 'replicate',
      retryable: true,
      cause: error,
    });
  },
};

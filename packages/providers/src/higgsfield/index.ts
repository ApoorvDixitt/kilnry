// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The Higgsfield adapter (TRD-06 §3.7, carries F-PRV-01, opt-in per D-44).
// Higgsfield is opt-in because it trains on inputs and outputs; the ProviderNotice
// (F-PRV-06) must be acknowledged before a key is saved. This adapter submits a
// request to a model endpoint, gets a request id and status URL back, and polls
// until the result is ready; a terminal nsfw status is a not-charged moderation
// rejection. The authoritative price comes from the free /estimate endpoint
// before submit. The key is a pair, sent as Authorization: Key ID:SECRET.

import {
  KilnryError,
  redact,
  registrySeed,
  type CanonicalRequest,
  type Estimate,
  type ModelManifest,
  type ProviderAdapter,
  type ProviderOutput,
  type AdapterContext,
  type SubmitHandle,
} from '@kilnry/core';
import { downloadOutputs } from '../download.js';
import { requestJson } from '../http.js';

const BASE_URL = 'https://api.higgsfield.ai';
// A free, minimal estimate endpoint used to test the key without spending.
const TEST_ENDPOINT = 'higgsfield-ai/soul/v2/standard';

interface SubmitResponse {
  status?: string;
  request_id?: string;
  status_url?: string;
  cancel_url?: string;
}

interface StatusResponse {
  request_id?: string;
  status?: string;
  images?: Array<{ url?: string; width?: number; height?: number }>;
  video?: { url?: string };
  audio?: { url?: string };
  usd?: string;
  credits?: string;
}

interface EstimateResponse {
  credits?: string;
  usd?: string;
}

function headers(key: string): HeadersInit {
  // The key arrives as "ID:SECRET"; it is sent verbatim after "Key ".
  return { Authorization: `Key ${key}`, 'Content-Type': 'application/json' };
}

function estimateBody(request: CanonicalRequest): Record<string, unknown> {
  return {
    prompt: request.prompt,
    ...(request.params.aspect_ratio ? { aspect_ratio: request.params.aspect_ratio } : {}),
    ...(request.params.resolution ? { resolution: request.params.resolution } : {}),
    ...(request.params.duration_s ? { duration: request.params.duration_s } : {}),
    ...(request.params.seed !== undefined ? { seed: request.params.seed } : {}),
    batch_size: request.count,
  };
}

function statusOutputs(status: StatusResponse): ProviderOutput[] {
  const outputs: ProviderOutput[] = [];
  for (const image of status.images ?? []) {
    if (image.url)
      outputs.push({
        kind: 'image',
        url: image.url,
        mime: 'image/png',
        ...(image.width ? { width: image.width } : {}),
        ...(image.height ? { height: image.height } : {}),
      });
  }
  if (status.video?.url) outputs.push({ kind: 'video', url: status.video.url, mime: 'video/mp4' });
  if (status.audio?.url) outputs.push({ kind: 'audio', url: status.audio.url, mime: 'audio/mpeg' });
  return outputs;
}

export const higgsfieldAdapter: ProviderAdapter = {
  id: 'higgsfield',
  display_name: 'Higgsfield',
  base_url: BASE_URL,
  key_detection: {
    pattern: /^[0-9a-f-]{36}:[A-Za-z0-9_-]{20,}$/,
    confidence: 'ambiguous',
    mask: (key) => `${key.slice(0, 8)}••••${key.slice(-4)}`,
  },
  concurrency: { default: 4, max_known: 20 },
  retention_days: 7,
  training_on_inputs: true,
  supports_authoritative_estimate: true,
  idempotency: 'none',
  async testKey(key, options) {
    const started = performance.now();
    try {
      await requestJson<EstimateResponse>({
        provider: 'higgsfield',
        fetch: options?.fetch ?? fetch,
        ...(options?.signal ? { signal: options.signal } : {}),
        url: `${options?.base_url ?? this.base_url}/estimate/${TEST_ENDPOINT}`,
        init: { method: 'POST', headers: headers(key), body: JSON.stringify({ prompt: 'test' }) },
        timeoutMs: 8_000,
      });
      return { ok: true, latency_ms: Math.round(performance.now() - started) };
    } catch (error) {
      return { ok: false, error: this.normalizeError(error) };
    }
  },
  listModels(): Promise<ModelManifest[]> {
    return Promise.resolve(registrySeed.filter((model) => model.provider === 'higgsfield'));
  },
  async authoritativeEstimate(request: CanonicalRequest, estimate: Estimate, context: AdapterContext) {
    const response = await requestJson<EstimateResponse>({
      provider: 'higgsfield',
      fetch: context.fetch,
      signal: context.signal,
      url: `${this.base_url}/estimate/${estimate.route.model}`,
      init: { method: 'POST', headers: headers(context.key), body: JSON.stringify(estimateBody(request)) },
    });
    const usd = Number(response.usd);
    return Number.isFinite(usd) && usd > 0 ? usd : estimate.estimate_usd;
  },
  async submit(request, context): Promise<SubmitHandle> {
    const model = request.params.extra?.model;
    if (typeof model !== 'string' || !model)
      throw new KilnryError('INVALID_INPUT', 'A Higgsfield model id is required.', {
        provider: 'higgsfield',
      });
    const payload = estimateBody(request);
    const response = await requestJson<SubmitResponse>({
      provider: 'higgsfield',
      fetch: context.fetch,
      signal: context.signal,
      url: `${this.base_url}/${model}`,
      init: { method: 'POST', headers: headers(context.key), body: JSON.stringify(payload) },
      timeoutMs: 30_000,
      ambiguousOnNetworkError: true,
    });
    if (!response.request_id)
      throw new KilnryError('PROVIDER_ERROR', 'Higgsfield accepted the request without a request id.', {
        provider: 'higgsfield',
        retryable: true,
      });
    return {
      provider: 'higgsfield',
      model_id: model,
      provider_request_id: response.request_id,
      status_url: response.status_url ?? `${this.base_url}/requests/${response.request_id}/status`,
      ...(response.cancel_url ? { cancel_url: response.cancel_url } : {}),
      submitted_at: new Date().toISOString(),
      payload_redacted: redact(payload),
    };
  },
  async poll(handle, context) {
    if (!handle.status_url)
      throw new KilnryError('PROVIDER_ERROR', 'Higgsfield job has no status URL.', {
        provider: 'higgsfield',
      });
    const status = await requestJson<StatusResponse>({
      provider: 'higgsfield',
      fetch: context.fetch,
      signal: context.signal,
      url: handle.status_url,
      init: { headers: headers(context.key) },
    });
    const state = status.status?.toLowerCase();
    if (state === 'queued') return { state: 'queued' };
    if (state === 'in_progress') return { state: 'running', step_label: 'Rendering at Higgsfield' };
    if (state === 'canceled') return { state: 'cancelled' };
    if (state === 'nsfw')
      return {
        state: 'moderated',
        billed: 'no',
        error: new KilnryError(
          'MODERATION_REJECTED',
          "Higgsfield's filter rejected this request. Not charged; the reserved credits were refunded.",
          { provider: 'higgsfield', retryable: false, details: { billed: 'no' } },
        ),
      };
    if (state === 'failed')
      return {
        state: 'failed',
        error: new KilnryError('PROVIDER_ERROR', 'Higgsfield generation failed. Not charged.', {
          provider: 'higgsfield',
          retryable: true,
        }),
      };
    if (state !== 'completed') return { state: 'running', step_label: 'Rendering at Higgsfield' };
    const outputs = statusOutputs(status);
    if (outputs.length === 0)
      throw new KilnryError('PROVIDER_ERROR', 'Higgsfield completed without a downloadable output.', {
        provider: 'higgsfield',
        retryable: true,
      });
    const usd = Number(status.usd);
    return {
      state: 'completed',
      result: {
        outputs,
        ...(Number.isFinite(usd) && usd > 0
          ? { billing: { actual_usd: usd, source: 'provider:estimate' } }
          : {}),
        raw_redacted: redact(status),
      },
    };
  },
  async cancel(handle, context) {
    if (!handle.cancel_url) return { ok: false, reason: 'Higgsfield did not return a cancel URL.' };
    await requestJson<Record<string, unknown>>({
      provider: 'higgsfield',
      fetch: context.fetch,
      signal: context.signal,
      url: handle.cancel_url,
      init: { method: 'POST', headers: headers(context.key) },
    }).catch(() => undefined);
    return { ok: true };
  },
  download(result, context) {
    return downloadOutputs('higgsfield', result, context, headers(context.key));
  },
  normalizeError(error) {
    return error instanceof KilnryError
      ? error
      : new KilnryError('PROVIDER_ERROR', 'Higgsfield returned an unexpected error.', {
          provider: 'higgsfield',
          retryable: true,
          cause: error,
        });
  },
};

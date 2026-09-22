// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import {
  KilnryError,
  redact,
  registrySeed,
  type CanonicalRequest,
  type ProviderAdapter,
  type ProviderOutput,
  type ProviderPriceUpdate,
} from '@kilnry/core';
import { downloadOutputs } from '../download.js';
import { providerHttpError } from '../errors.js';
import { requestJson } from '../http.js';
import { priceUpdate, withBasePrice } from '../pricing.js';

interface FalSubmit {
  request_id?: string;
  status_url?: string;
  response_url?: string;
  cancel_url?: string;
}

interface FalStatus {
  status?: string;
  queue_position?: number;
  logs?: Array<{ message?: string }>;
  error?: string;
}

interface FalPriceResponse {
  prices?: Array<{ endpoint_id?: string; unit_price?: number; unit?: string; currency?: string }>;
}

async function currentPrices(
  key: string,
  options: { fetch?: typeof fetch; signal?: AbortSignal } = {},
): Promise<ProviderPriceUpdate[]> {
  const manifests = registrySeed.filter((model) => model.provider === 'fal');
  const updates: ProviderPriceUpdate[] = [];
  for (let offset = 0; offset < manifests.length; offset += 50) {
    const batch = manifests.slice(offset, offset + 50);
    const endpointIds = batch.map((model) => model.model_id).join(',');
    const response = await requestJson<FalPriceResponse>({
      provider: 'fal',
      fetch: options.fetch ?? fetch,
      ...(options.signal ? { signal: options.signal } : {}),
      url: `https://api.fal.ai/v1/models/pricing?endpoint_id=${encodeURIComponent(endpointIds)}`,
      init: { headers: headers(key) },
    });
    for (const quote of response.prices ?? []) {
      const model = batch.find((candidate) => candidate.model_id === quote.endpoint_id);
      if (!model || quote.unit_price === undefined || !Number.isFinite(quote.unit_price)) continue;
      updates.push(
        priceUpdate(
          model,
          withBasePrice(model.price_rule, quote.unit_price),
          'https://api.fal.ai/v1/models/pricing',
        ),
      );
    }
  }
  return updates;
}

function headers(key: string): HeadersInit {
  return { Authorization: `Key ${key}`, 'Content-Type': 'application/json' };
}

function falPayload(request: CanonicalRequest): Record<string, unknown> {
  const extra = { ...(request.params.extra ?? {}) };
  const model = extra.model;
  delete extra.model;
  delete extra.route_why;
  for (const key of [
    'prompt',
    'negative_prompt',
    'image_url',
    'end_image_url',
    'image_urls',
    'audio_url',
    'video_url',
  ]) {
    if (key in extra) {
      throw new KilnryError('INVALID_INPUT', `Provider passthrough cannot override canonical field ${key}.`);
    }
  }
  const payload: Record<string, unknown> = { prompt: request.prompt };
  if (request.negative_prompt) payload.negative_prompt = request.negative_prompt;
  if (request.params.width && request.params.height)
    payload.image_size = { width: request.params.width, height: request.params.height };
  if (request.params.aspect_ratio) payload.aspect_ratio = request.params.aspect_ratio;
  if (request.params.resolution) payload.resolution = request.params.resolution;
  if (request.params.duration_s) {
    payload.duration =
      typeof model === 'string' && /veo/i.test(model)
        ? `${request.params.duration_s}s`
        : typeof model === 'string' && /kling|seedance/i.test(model)
          ? String(request.params.duration_s)
          : request.params.duration_s;
  }
  if (request.params.audio !== undefined) payload.generate_audio = request.params.audio;
  if (request.params.seed !== undefined) payload.seed = request.params.seed;
  if (request.count > 1) payload.num_images = request.count;
  for (const media of request.medias) {
    if (!media.url)
      throw new KilnryError(
        'INVALID_INPUT',
        'fal media inputs must be uploaded or use an HTTPS URL before submit.',
      );
    if (media.role === 'start_frame') payload.image_url = media.url;
    else if (media.role === 'end_frame') payload.end_image_url = media.url;
    else if (media.role === 'audio') payload.audio_url = media.url;
    else if (media.role === 'video' || media.role === 'driving_video') payload.video_url = media.url;
    else {
      const images = Array.isArray(payload.image_urls) ? payload.image_urls : [];
      payload.image_urls = [...images, media.url];
    }
  }
  return { ...extra, ...payload };
}

// A training submit uses a different shape from generation: the zipped images,
// the trigger word and the step count (F-CHR-07, TRD-14 §10.1). The orchestrator
// uploads the zip and passes its URL plus the training options in params.extra.
function falTrainingPayload(request: CanonicalRequest): Record<string, unknown> {
  const extra = { ...(request.params.extra ?? {}) };
  delete extra.model;
  delete extra.route_why;
  return extra;
}

// The LoRA file a completed fal training returns.
function falTrainingOutput(body: Record<string, unknown>): ProviderOutput[] {
  const file = body.diffusers_lora_file;
  if (typeof file === 'object' && file !== null && 'url' in file && typeof file.url === 'string') {
    return [{ kind: 'json', url: file.url, mime: 'application/octet-stream' }];
  }
  return [];
}

function outputs(body: Record<string, unknown>): ProviderOutput[] {
  const result: ProviderOutput[] = [];
  if (Array.isArray(body.images)) {
    for (const image of body.images) {
      if (typeof image === 'object' && image !== null && 'url' in image && typeof image.url === 'string') {
        result.push({
          kind: 'image',
          url: image.url,
          mime: typeof image.content_type === 'string' ? image.content_type : 'image/png',
        });
      }
    }
  }
  for (const [key, kind, mime] of [
    ['image', 'image', 'image/png'],
    ['video', 'video', 'video/mp4'],
    ['audio', 'audio', 'audio/mpeg'],
    ['model', '3d', 'model/gltf-binary'],
  ] as const) {
    const value = body[key];
    if (typeof value === 'object' && value !== null && 'url' in value && typeof value.url === 'string') {
      result.push({
        kind,
        url: value.url,
        mime: 'content_type' in value && typeof value.content_type === 'string' ? value.content_type : mime,
      });
    }
  }
  return result;
}

export const falAdapter: ProviderAdapter = {
  id: 'fal',
  display_name: 'fal',
  base_url: 'https://queue.fal.run',
  key_detection: {
    pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{32}$/i,
    confidence: 'high',
    mask: (key) => `${key.slice(0, 5)}••••${key.slice(-4)}`,
  },
  concurrency: { default: 2, max_known: null, hold_until_terminal: true },
  retention_days: 7,
  training_on_inputs: false,
  supports_authoritative_estimate: true,
  idempotency: 'none',
  async testKey(key, options) {
    const started = performance.now();
    try {
      const response = await requestJson<FalPriceResponse>({
        provider: 'fal',
        fetch: options?.fetch ?? fetch,
        ...(options?.signal ? { signal: options.signal } : {}),
        url: 'https://api.fal.ai/v1/models/pricing?endpoint_id=fal-ai%2Fflux-2%2Fklein%2F4b',
        init: { headers: headers(key) },
        timeoutMs: 8_000,
      });
      return {
        ok: true,
        latency_ms: Math.round(performance.now() - started),
        model_count: response.prices?.length ?? 0,
      };
    } catch (error) {
      return { ok: false, error: this.normalizeError(error) };
    }
  },
  async listModels(key, options) {
    const manifests = registrySeed.filter((model) => model.provider === 'fal');
    if (!key) return manifests;
    const updates = new Map(
      (await currentPrices(key, options)).map((update) => [update.model_id, update.price_rule]),
    );
    return manifests.map((model) => ({
      ...model,
      price_rule: updates.get(model.model_id) ?? model.price_rule,
    }));
  },
  refreshPrices(key, options) {
    return currentPrices(key, options);
  },
  async authoritativeEstimate(request, estimate, context) {
    const response = await requestJson<FalPriceResponse>({
      provider: 'fal',
      fetch: context.fetch,
      signal: context.signal,
      url: `https://api.fal.ai/v1/models/pricing?endpoint_id=${encodeURIComponent(estimate.route.model)}`,
      init: { headers: headers(context.key) },
    });
    const price = response.prices?.find((item) => item.endpoint_id === estimate.route.model)?.unit_price;
    if (price === undefined || estimate.unit_price.amount_usd <= 0) return estimate.estimate_usd;
    return estimate.estimate_usd * (price / estimate.unit_price.amount_usd);
  },
  // fal's own storage (TRD-06 §3.1): ask for a presigned address, put the bytes
  // there, and hand the provider the file address it answered with.
  async uploadFile(file, context) {
    const initiated = await requestJson<{ upload_url?: string; file_url?: string }>({
      provider: 'fal',
      fetch: context.fetch,
      signal: context.signal,
      url: 'https://rest.alpha.fal.ai/storage/upload/initiate',
      init: {
        method: 'POST',
        headers: { ...headers(context.key), 'Content-Type': 'application/json' },
        body: JSON.stringify({ content_type: file.mime, file_name: file.file_name }),
      },
      timeoutMs: 30_000,
    });
    if (!initiated.upload_url || !initiated.file_url)
      throw new KilnryError('PROVIDER_ERROR', 'fal did not return an upload address.', {
        provider: 'fal',
        retryable: true,
      });
    const put = await context.fetch(initiated.upload_url, {
      method: 'PUT',
      headers: { 'Content-Type': file.mime },
      body: file.bytes as unknown as BodyInit,
      signal: context.signal,
    });
    if (!put.ok) throw providerHttpError('fal', put.status, await put.text().catch(() => ''));
    return { url: initiated.file_url };
  },
  async submit(request, context) {
    const model = request.params.extra?.model;
    if (typeof model !== 'string' || !model)
      throw new KilnryError('INVALID_INPUT', 'A fal model id is required.');
    const training = request.capability === 'train_lora' || request.capability === 'train_identity';
    const payload = training ? falTrainingPayload(request) : falPayload(request);
    const response = await requestJson<FalSubmit>({
      provider: 'fal',
      fetch: context.fetch,
      signal: context.signal,
      url: `${this.base_url}/${model}`,
      init: {
        method: 'POST',
        headers: {
          ...headers(context.key),
          'X-Fal-Request-Timeout': '900',
          'X-Fal-Store-IO': '0',
          'X-Fal-Object-Lifecycle-Preference': JSON.stringify({ expiration_duration_seconds: 604_800 }),
        },
        body: JSON.stringify(payload),
      },
      timeoutMs: 30_000,
      ambiguousOnNetworkError: true,
    });
    if (!response.request_id)
      throw new KilnryError('PROVIDER_ERROR', 'fal accepted the request without returning a request id.', {
        provider: 'fal',
        retryable: true,
      });
    return {
      provider: 'fal',
      model_id: model,
      provider_request_id: response.request_id,
      status_url: response.status_url ?? `${this.base_url}/${model}/requests/${response.request_id}/status`,
      response_url: response.response_url ?? `${this.base_url}/${model}/requests/${response.request_id}`,
      ...(response.cancel_url ? { cancel_url: response.cancel_url } : {}),
      submitted_at: new Date().toISOString(),
      payload_redacted: redact(payload),
    };
  },
  async poll(handle, context) {
    if (!handle.status_url)
      throw new KilnryError('PROVIDER_ERROR', 'fal job has no status URL.', { provider: 'fal' });
    const status = await requestJson<FalStatus>({
      provider: 'fal',
      fetch: context.fetch,
      signal: context.signal,
      url: `${handle.status_url}${handle.status_url.includes('?') ? '&' : '?'}logs=1`,
      init: { headers: headers(context.key) },
    });
    const state = status.status?.toUpperCase();
    if (state === 'IN_QUEUE' || state === 'PENDING')
      return {
        state: 'queued',
        ...(status.queue_position === undefined ? {} : { position: status.queue_position }),
      };
    if (state === 'IN_PROGRESS' || state === 'RUNNING')
      return {
        state: 'running',
        step_label: status.logs?.at(-1)?.message ?? 'Rendering at fal',
        logs: status.logs?.flatMap((entry) => (entry.message ? [entry.message] : [])) ?? [],
      };
    if (state === 'CANCELLED' || state === 'CANCELED') return { state: 'cancelled' };
    if (state === 'FAILED' || status.error)
      return {
        state: 'failed',
        error: new KilnryError(
          'PROVIDER_ERROR',
          `fal returned an error. ${status.error ?? 'The request failed.'}`,
          { provider: 'fal', retryable: false },
        ),
      };
    if (state !== 'COMPLETED') return { state: 'running', step_label: 'Rendering at fal' };
    if (!handle.response_url)
      throw new KilnryError('PROVIDER_ERROR', 'fal job has no response URL.', { provider: 'fal' });
    const body = await requestJson<Record<string, unknown>>({
      provider: 'fal',
      fetch: context.fetch,
      signal: context.signal,
      url: handle.response_url,
      init: { headers: headers(context.key) },
    });
    const parsed = outputs(body);
    if (parsed.length === 0) {
      // A LoRA training completes with a diffusers file rather than images
      // (F-CHR-07); surface it as a JSON output the orchestrator downloads.
      const trained = falTrainingOutput(body);
      if (trained.length > 0)
        return { state: 'completed', result: { outputs: trained, raw_redacted: redact(body) } };
      throw new KilnryError('PROVIDER_ERROR', 'fal completed without a downloadable output.', {
        provider: 'fal',
        retryable: true,
      });
    }
    return { state: 'completed', result: { outputs: parsed, raw_redacted: redact(body) } };
  },
  async cancel(handle, context) {
    if (!handle.cancel_url) return { ok: false, reason: 'fal did not return a cancel URL.' };
    await requestJson<Record<string, unknown>>({
      provider: 'fal',
      fetch: context.fetch,
      signal: context.signal,
      url: handle.cancel_url,
      init: { method: 'PUT', headers: headers(context.key) },
    });
    return { ok: true };
  },
  download(result, context) {
    return downloadOutputs('fal', result, context);
  },
  normalizeError(error) {
    if (error instanceof KilnryError) return error;
    if (error instanceof Response) return providerHttpError('fal', error.status, undefined, error.headers);
    return new KilnryError('PROVIDER_ERROR', 'fal returned an unexpected error.', {
      provider: 'fal',
      retryable: true,
      cause: error,
    });
  },
};

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
import { falEndpointSchema } from './schemas.js';
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
  const schema = falEndpointSchema(typeof model === 'string' ? model : undefined);
  const fields = schema?.fields ?? {};
  for (const key of [
    'prompt',
    'negative_prompt',
    'image_url',
    'start_image_url',
    'end_image_url',
    'image_urls',
    'reference_image_urls',
    'reference_video_urls',
    'reference_audio_urls',
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
    // Each family's own type: Veo wants "6s", Kling, Seedance and Wan 2.7 want
    // the enum string "6", and the rest take the number. Wan 2.7's duration is
    // a DurationEnum of strings on both the image-to-video and the edit-video
    // pages (read 2026-10-07), and it was sent as a number, so any non-default
    // duration was refused or ignored (F-95, F-96).
    payload.duration =
      typeof model === 'string' && /veo/i.test(model)
        ? `${request.params.duration_s}s`
        : typeof model === 'string' && /kling|seedance|wan\/v2\.7/i.test(model)
          ? String(request.params.duration_s)
          : request.params.duration_s;
  }
  if (request.params.audio !== undefined) payload.generate_audio = request.params.audio;
  if (request.params.seed !== undefined) payload.seed = request.params.seed;
  if (request.count > 1) payload.num_images = request.count;
  // Each media input goes under the field the endpoint's own schema names
  // (fal/schemas.ts; F-09, F-10, F-11): `start_image_url` for Kling v3 and
  // Wan 3.0 image-to-video, a singular `image_url` for one-image endpoints,
  // `reference_*_urls` lists for Wan 3.0 reference-to-video. Endpoints the
  // table does not list keep the generic names they were built and tested on.
  const append = (key: string, url: string): void => {
    const list = Array.isArray(payload[key]) ? (payload[key] as unknown[]) : [];
    payload[key] = [...list, url];
  };
  const hasStartFrame = request.medias.some((media) => media.role === 'start_frame');
  const references: string[] = [];
  for (const media of request.medias) {
    if (!media.url)
      throw new KilnryError(
        'INVALID_INPUT',
        'fal media inputs must be uploaded or use an HTTPS URL before submit.',
      );
    if (media.role === 'start_frame') payload[fields.start_frame ?? 'image_url'] = media.url;
    else if (media.role === 'end_frame') payload[fields.end_frame ?? 'end_image_url'] = media.url;
    else if (media.role === 'audio') {
      if (fields.reference_audios) append(fields.reference_audios, media.url);
      else payload.audio_url = media.url;
    } else if (media.role === 'video' || media.role === 'driving_video') {
      if (fields.reference_videos) append(fields.reference_videos, media.url);
      else payload.video_url = media.url;
    } else references.push(media.url);
  }
  if (references.length > 0) {
    if (fields.single_image) {
      // A one-image endpoint takes its source image under a singular field.
      if (references.length > 1) {
        throw new KilnryError(
          'INVALID_INPUT',
          `${String(model)} takes one source image; ${references.length} were given.`,
        );
      }
      payload[fields.single_image] = references[0];
    } else if (fields.reference_as_start_frame) {
      // Kling v3 image-to-video has no reference-image list: the first
      // reference is its start frame when no start frame was given.
      if (!hasStartFrame) payload[fields.start_frame ?? 'image_url'] = references[0];
    } else {
      for (const url of references) append(fields.reference_images ?? 'image_urls', url);
    }
  }
  return { ...renameExtras(extra, model), ...payload };
}

/**
 * The passthrough keys fal's current pages spell differently from the names
 * Kilnry's registry and estimator use. A key that reaches fal under the wrong
 * name is silently ignored while the user is still quoted and billed for the
 * feature it buys, which is what happened to Nano Banana 2's web search and
 * Topaz's frame interpolation (F-48, F-49). Each rename cites the page it was
 * read from on 2026-10-07.
 */
const EXTRA_RENAMES: Array<{ model: RegExp; from: string; to: string }> = [
  // https://fal.ai/models/fal-ai/nano-banana-2/llms.txt — `enable_web_search`.
  { model: /nano-banana-2/i, from: 'web_search', to: 'enable_web_search' },
  // https://fal.ai/models/fal-ai/topaz/upscale/video/llms.txt — `target_fps`,
  // and "frame interpolation is automatically enabled when target_fps is set".
  { model: /topaz\/upscale\/video/i, from: 'fps', to: 'target_fps' },
];

function renameExtras(extra: Record<string, unknown>, model: unknown): Record<string, unknown> {
  if (typeof model !== 'string') return extra;
  const out = { ...extra };
  for (const rename of EXTRA_RENAMES) {
    if (!rename.model.test(model)) continue;
    if (rename.from in out && !(rename.to in out)) {
      out[rename.to] = out[rename.from];
      delete out[rename.from];
    }
  }
  return out;
}

// Image → 3D takes one source image under a model-specific field and no prompt:
// Trellis reads `image_url`, Hunyuan3D v3 reads `input_image_url` (F-CRE-15).
function fal3dPayload(request: CanonicalRequest, model: string): Record<string, unknown> {
  const extra = { ...(request.params.extra ?? {}) };
  delete extra.model;
  delete extra.route_why;
  const field = /hunyuan3d/i.test(model) ? 'input_image_url' : 'image_url';
  if (field in extra || 'image_url' in extra) {
    throw new KilnryError('INVALID_INPUT', `Provider passthrough cannot override canonical field ${field}.`);
  }
  const source = request.medias.find((media) => media.role === 'reference' || media.role === 'start_frame');
  if (!source?.url) {
    throw new KilnryError('INVALID_INPUT', '3D generation needs one uploaded source image.');
  }
  return {
    ...extra,
    [field]: source.url,
    ...(request.params.seed === undefined ? {} : { seed: request.params.seed }),
  };
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
    // Trellis answers `model_mesh`, Hunyuan3D v3 answers `model_glb` (F-CRE-15).
    ['model_mesh', '3d', 'model/gltf-binary'],
    ['model_glb', '3d', 'model/gltf-binary'],
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
  // A speech-to-text response carries the words inline, not as a file. Turn it
  // into a Kilnry transcript JSON (TRD-09 §4.1) and hand it back as a json
  // output the orchestrator writes as a document asset (F-WFL-06).
  if (result.length === 0 && Array.isArray(body.chunks)) {
    const words = (body.chunks as Array<{ text?: unknown; timestamp?: unknown }>).flatMap((chunk) => {
      const text = typeof chunk.text === 'string' ? chunk.text.trim() : '';
      const span = Array.isArray(chunk.timestamp) ? (chunk.timestamp as unknown[]) : [];
      const start = Number(span[0]);
      const end = Number(span[1]);
      if (text === '' || !Number.isFinite(start) || !Number.isFinite(end)) return [];
      return [{ w: text, start, end }];
    });
    const transcript = {
      kilnry_transcript: 1 as const,
      language: typeof body.language === 'string' ? body.language : 'en',
      duration_s: words.length > 0 ? words[words.length - 1]!.end : 0,
      source: 'fal' as const,
      words,
    };
    result.push({
      kind: 'json',
      base64: Buffer.from(JSON.stringify(transcript), 'utf8').toString('base64'),
      mime: 'application/json',
    });
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
    const payload = training
      ? falTrainingPayload(request)
      : request.capability === '3d'
        ? fal3dPayload(request, model)
        : falPayload(request);
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

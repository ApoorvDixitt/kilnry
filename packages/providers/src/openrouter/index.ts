// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import {
  KilnryError,
  priceSummary,
  redact,
  registrySeed,
  type CanonicalRequest,
  type PollStatus,
  type ProviderAdapter,
  type ProviderOutput,
  type ProviderPriceUpdate,
  type ProviderResult,
} from '@kilnry/core';
import { downloadOutputs } from '../download.js';
import { providerHttpError } from '../errors.js';
import { requestJson } from '../http.js';
import { priceUpdate, withImagePricing, withTokenPricing, withVideoPricing } from '../pricing.js';

interface OpenRouterImageResponse {
  data?: Array<{ b64_json?: string; media_type?: string; url?: string }>;
  usage?: { cost?: number; prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

interface OpenRouterVideoResponse {
  id?: string;
  polling_url?: string;
  status?: string;
  unsigned_urls?: string[];
  usage?: { cost?: number };
  error?: string;
  duration?: number;
}

interface OpenRouterKeyResponse {
  data?: { label?: string; limit?: number | null; limit_remaining?: number | null; usage?: number };
}

interface OpenRouterImageCatalog {
  data?: Array<{
    id?: string;
    endpoints?: string;
    supported_parameters?: Record<string, unknown>;
  }>;
}

interface OpenRouterImageEndpoints {
  endpoints?: Array<{
    pricing?: Array<{ billable?: string; cost_usd?: number; unit?: string }>;
  }>;
  data?: Array<{
    pricing?: Array<{ billable?: string; cost_usd?: number; unit?: string }>;
  }>;
}

interface OpenRouterVideoCatalog {
  data?: Array<{ id?: string; pricing_skus?: Record<string, string | number> }>;
}

interface OpenRouterModelCatalog {
  data?: Array<{
    id?: string;
    pricing?: { prompt?: string | number; completion?: string | number; input_cache_read?: string | number };
  }>;
}

function headers(key: string): HeadersInit {
  return {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://kilnry.app',
    'X-Title': 'Kilnry',
  };
}

async function currentPrices(
  key: string,
  options: { fetch?: typeof fetch; signal?: AbortSignal } = {},
): Promise<ProviderPriceUpdate[]> {
  const requestFetch = options.fetch ?? fetch;
  const requestOptions = {
    provider: 'openrouter' as const,
    fetch: requestFetch,
    ...(options.signal ? { signal: options.signal } : {}),
    init: { headers: headers(key) },
  };
  const [imageCatalog, videoCatalog, modelCatalog] = await Promise.all([
    requestJson<OpenRouterImageCatalog>({
      ...requestOptions,
      url: 'https://openrouter.ai/api/v1/images/models',
    }),
    requestJson<OpenRouterVideoCatalog>({
      ...requestOptions,
      url: 'https://openrouter.ai/api/v1/videos/models',
    }),
    requestJson<OpenRouterModelCatalog>({
      ...requestOptions,
      url: 'https://openrouter.ai/api/v1/models',
    }),
  ]);
  const manifests = registrySeed.filter((model) => model.provider === 'openrouter');
  const updates = new Map<string, ProviderPriceUpdate>();
  for (const catalogModel of imageCatalog.data ?? []) {
    if (!catalogModel.id || !catalogModel.endpoints) continue;
    const model = manifests.find((candidate) => candidate.model_id === catalogModel.id);
    if (!model) continue;
    const endpointUrl = new URL(catalogModel.endpoints, 'https://openrouter.ai').toString();
    const response = await requestJson<OpenRouterImageEndpoints>({
      ...requestOptions,
      url: endpointUrl,
    });
    const endpointRules = [...(response.endpoints ?? []), ...(response.data ?? [])]
      .filter((endpoint) => (endpoint.pricing?.length ?? 0) > 0)
      .map((endpoint) => withImagePricing(model.price_rule, endpoint.pricing ?? []));
    if (endpointRules.length === 0) continue;
    endpointRules.sort((left, right) => priceSummary(left).amount - priceSummary(right).amount);
    updates.set(model.model_id, priceUpdate(model, endpointRules[0]!, endpointUrl));
  }
  for (const catalogModel of videoCatalog.data ?? []) {
    if (!catalogModel.id || !catalogModel.pricing_skus) continue;
    const model = manifests.find((candidate) => candidate.model_id === catalogModel.id);
    if (!model) continue;
    updates.set(
      model.model_id,
      priceUpdate(
        model,
        withVideoPricing(model.price_rule, catalogModel.pricing_skus),
        'https://openrouter.ai/api/v1/videos/models',
      ),
    );
  }
  for (const catalogModel of modelCatalog.data ?? []) {
    if (!catalogModel.id || !catalogModel.pricing) continue;
    const model = manifests.find((candidate) => candidate.model_id === catalogModel.id);
    if (!model || model.price_rule.kind !== 'per_million_tokens') continue;
    updates.set(
      model.model_id,
      priceUpdate(
        model,
        withTokenPricing(model.price_rule, catalogModel.pricing),
        'https://openrouter.ai/api/v1/models',
      ),
    );
  }
  return [...updates.values()];
}

function mediaInputs(request: CanonicalRequest): Array<{ url: string }> {
  return request.medias.map((media) => {
    if (!media.url)
      throw new KilnryError(
        'INVALID_INPUT',
        'OpenRouter media inputs must be HTTPS URLs or data URIs before submit.',
      );
    return { url: media.url };
  });
}

function passthrough(request: CanonicalRequest, reserved: string[]): Record<string, unknown> {
  const extra = { ...(request.params.extra ?? {}) };
  delete extra.model;
  delete extra.route_why;
  for (const key of reserved) {
    if (key in extra) {
      throw new KilnryError('INVALID_INPUT', `Provider passthrough cannot override canonical field ${key}.`);
    }
  }
  return extra;
}

function imagePayload(request: CanonicalRequest, model: string): Record<string, unknown> {
  return {
    ...passthrough(request, ['model', 'prompt', 'n', 'input_references']),
    model,
    prompt: request.prompt,
    n: request.count,
    ...(request.params.aspect_ratio ? { aspect_ratio: request.params.aspect_ratio } : {}),
    ...(request.params.resolution ? { resolution: request.params.resolution } : {}),
    ...(request.params.quality ? { quality: request.params.quality } : {}),
    ...(request.medias.length > 0 ? { input_references: mediaInputs(request) } : {}),
  };
}

function videoPayload(request: CanonicalRequest, model: string): Record<string, unknown> {
  const frameImages = request.medias
    .filter((media) => media.role === 'start_frame' || media.role === 'end_frame')
    .map((media) => {
      if (!media.url)
        throw new KilnryError(
          'INVALID_INPUT',
          'OpenRouter frame inputs must be HTTPS URLs or data URIs before submit.',
        );
      return {
        image_url: media.url,
        frame_type: media.role === 'start_frame' ? 'first_frame' : 'last_frame',
      };
    });
  const references = request.medias.filter((media) => !['start_frame', 'end_frame'].includes(media.role));
  return {
    ...passthrough(request, ['model', 'prompt', 'frame_images', 'input_references']),
    model,
    prompt: request.prompt,
    ...(request.params.resolution ? { resolution: request.params.resolution } : {}),
    ...(request.params.duration_s ? { duration: request.params.duration_s } : {}),
    ...(request.params.aspect_ratio ? { aspect_ratio: request.params.aspect_ratio } : {}),
    ...(request.params.audio !== undefined ? { generate_audio: request.params.audio } : {}),
    ...(request.params.seed !== undefined ? { seed: request.params.seed } : {}),
    ...(frameImages.length > 0 ? { frame_images: frameImages } : {}),
    ...(references.length > 0 ? { input_references: mediaInputs({ ...request, medias: references }) } : {}),
  };
}

function moderated(error: string | undefined): boolean {
  return Boolean(error && /(?:safety|policy|RAI|blocked|nsfw)/i.test(error));
}

export const openRouterAdapter: ProviderAdapter = {
  id: 'openrouter',
  display_name: 'OpenRouter',
  base_url: 'https://openrouter.ai/api/v1',
  key_detection: {
    pattern: /^sk-or-v1-[0-9a-f]{64}$/i,
    confidence: 'high',
    mask: (key) => `${key.slice(0, 8)}••••${key.slice(-4)}`,
  },
  concurrency: { default: 4, max_known: null },
  retention_days: null,
  training_on_inputs: false,
  supports_authoritative_estimate: false,
  idempotency: 'none',
  async testKey(key, options) {
    const started = performance.now();
    try {
      const response = await requestJson<OpenRouterKeyResponse>({
        provider: 'openrouter',
        fetch: options?.fetch ?? fetch,
        ...(options?.signal ? { signal: options.signal } : {}),
        url: `${options?.base_url ?? this.base_url}/key`,
        init: { headers: headers(key) },
        timeoutMs: 8_000,
      });
      return {
        ok: true,
        latency_ms: Math.round(performance.now() - started),
        ...(response.data?.limit_remaining === null || response.data?.limit_remaining === undefined
          ? {}
          : { balance_usd: response.data.limit_remaining }),
        ...(response.data?.label ? { account: response.data.label } : {}),
        model_count: registrySeed.filter((model) => model.provider === 'openrouter').length,
      };
    } catch (error) {
      return { ok: false, error: this.normalizeError(error) };
    }
  },
  async listModels(key, options) {
    if (key) {
      await Promise.all([
        requestJson<{ data?: unknown[] }>({
          provider: 'openrouter',
          fetch: options?.fetch ?? fetch,
          ...(options?.signal ? { signal: options.signal } : {}),
          url: `${this.base_url}/images/models`,
          init: { headers: headers(key) },
        }),
        requestJson<{ data?: unknown[] }>({
          provider: 'openrouter',
          fetch: options?.fetch ?? fetch,
          ...(options?.signal ? { signal: options.signal } : {}),
          url: `${this.base_url}/videos/models`,
          init: { headers: headers(key) },
        }),
      ]);
    }
    return registrySeed.filter((model) => model.provider === 'openrouter');
  },
  refreshPrices(key, options) {
    return currentPrices(key, options);
  },
  async submit(request, context) {
    const model = request.params.extra?.model;
    if (typeof model !== 'string' || !model)
      throw new KilnryError('INVALID_INPUT', 'An OpenRouter model id is required.');
    const image = ['text2image', 'image_edit'].includes(request.capability);
    const payload = image ? imagePayload(request, model) : videoPayload(request, model);
    if (image) {
      const response = await requestJson<OpenRouterImageResponse>({
        provider: 'openrouter',
        fetch: context.fetch,
        signal: context.signal,
        url: `${this.base_url}/images`,
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
        throw new KilnryError('PROVIDER_ERROR', 'OpenRouter completed without returning image bytes.', {
          provider: 'openrouter',
          retryable: true,
        });
      const result: ProviderResult = {
        outputs,
        ...(response.usage?.cost === undefined
          ? {}
          : {
              billing: {
                actual_usd: response.usage.cost,
                usage: response.usage as Record<string, number>,
                source: 'provider:usage.cost',
              },
            }),
        raw_redacted: redact(response),
      };
      return {
        provider: 'openrouter',
        model_id: model,
        provider_request_id: `inline-${crypto.randomUUID()}`,
        submitted_at: new Date().toISOString(),
        inline_result: result,
        payload_redacted: redact(payload),
      };
    }

    const response = await requestJson<OpenRouterVideoResponse>({
      provider: 'openrouter',
      fetch: context.fetch,
      signal: context.signal,
      url: `${this.base_url}/videos`,
      init: { method: 'POST', headers: headers(context.key), body: JSON.stringify(payload) },
      timeoutMs: 30_000,
      ambiguousOnNetworkError: true,
    });
    if (!response.id)
      throw new KilnryError('PROVIDER_ERROR', 'OpenRouter accepted the video without returning a job id.', {
        provider: 'openrouter',
        retryable: true,
      });
    return {
      provider: 'openrouter',
      model_id: model,
      provider_request_id: response.id,
      status_url: response.polling_url ?? `${this.base_url}/videos/${response.id}`,
      response_url: `${this.base_url}/videos/${response.id}/content?index=0`,
      submitted_at: new Date().toISOString(),
      payload_redacted: redact(payload),
    };
  },
  async poll(handle, context): Promise<PollStatus> {
    if (!handle.status_url)
      throw new KilnryError('PROVIDER_ERROR', 'OpenRouter video has no polling URL.', {
        provider: 'openrouter',
      });
    const response = await requestJson<OpenRouterVideoResponse>({
      provider: 'openrouter',
      fetch: context.fetch,
      signal: context.signal,
      url: handle.status_url,
      init: { headers: headers(context.key) },
    });
    const status = response.status?.toLowerCase();
    if (status === 'pending' || status === 'queued') return { state: 'queued' };
    if (status === 'processing' || status === 'running' || !status)
      return { state: 'running', step_label: 'Rendering at OpenRouter' };
    if (status === 'cancelled' || status === 'canceled') return { state: 'cancelled' };
    if (status === 'failed') {
      const isModerated = moderated(response.error);
      const error = new KilnryError(
        isModerated ? 'MODERATION_REJECTED' : 'PROVIDER_ERROR',
        isModerated
          ? "Blocked by the provider's content filter. Not charged."
          : `OpenRouter returned an error. ${response.error ?? ''}`.trim(),
        { provider: 'openrouter', retryable: false },
      );
      return isModerated ? { state: 'moderated', error, billed: 'no' } : { state: 'failed', error };
    }
    if (status !== 'completed') return { state: 'running', step_label: `OpenRouter status: ${status}` };
    const urls = response.unsigned_urls?.length
      ? response.unsigned_urls
      : handle.response_url
        ? [handle.response_url]
        : [];
    if (urls.length === 0)
      throw new KilnryError('PROVIDER_ERROR', 'OpenRouter video completed without a content URL.', {
        provider: 'openrouter',
        retryable: true,
      });
    return {
      state: 'completed',
      result: {
        outputs: urls.map((url) => ({
          kind: 'video',
          url,
          mime: 'video/mp4',
          ...(response.duration === undefined ? {} : { duration_s: response.duration }),
        })),
        ...(response.usage?.cost === undefined
          ? {}
          : {
              billing: {
                actual_usd: response.usage.cost,
                usage: response.usage as Record<string, number>,
                source: 'provider:usage.cost',
              },
            }),
        raw_redacted: redact(response),
      },
    };
  },
  cancel() {
    return Promise.resolve({
      ok: false,
      reason: 'OpenRouter does not document a video cancellation endpoint.',
    });
  },
  download(result, context) {
    return downloadOutputs('openrouter', result, context, headers(context.key));
  },
  normalizeError(error) {
    if (error instanceof KilnryError) return error;
    if (error instanceof Response)
      return providerHttpError('openrouter', error.status, undefined, error.headers);
    return new KilnryError('PROVIDER_ERROR', 'OpenRouter returned an unexpected error.', {
      provider: 'openrouter',
      retryable: true,
      cause: error,
    });
  },
};

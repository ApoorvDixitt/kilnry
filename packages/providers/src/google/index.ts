// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The Google Gemini adapter (TRD-06 §3.3, carries F-PRV-01). It talks to the
// Generative Language API: image and vision-language (VLM) and language (LLM)
// generation run synchronously through {model}:generateContent, while Veo video
// runs as a long-running operation ({model}:predictLongRunning, then GET on the
// operation name until done). Moderation is an HTTP 200 with a block reason for
// images and text, or a filtered-media count for Veo; both are reported as
// MODERATION_REJECTED with billed:'no'. The key is a header, x-goog-api-key.

import {
  KilnryError,
  redact,
  registrySeed,
  type CanonicalRequest,
  type ModelManifest,
  type ProviderAdapter,
  type ProviderOutput,
  type ProviderResult,
  type SubmitHandle,
} from '@kilnry/core';
import { downloadOutputs } from '../download.js';
import { providerHttpError } from '../errors.js';
import { requestJson } from '../http.js';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

// The finish reasons Google uses to signal a safety block on generateContent.
const BLOCKED_FINISH = new Set(['SAFETY', 'IMAGE_SAFETY', 'RECITATION', 'PROHIBITED_CONTENT']);

interface GenerateContentResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; inlineData?: { mimeType?: string; data?: string } }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
}

interface OperationResponse {
  name?: string;
  done?: boolean;
  error?: { code?: number; message?: string };
  response?: {
    generateVideoResponse?: {
      generatedSamples?: Array<{ video?: { uri?: string } }>;
      raiMediaFilteredCount?: number;
    };
  };
}

function headers(key: string): HeadersInit {
  return { 'x-goog-api-key': key, 'Content-Type': 'application/json' };
}

function moderated(reason: string): KilnryError {
  return new KilnryError('MODERATION_REJECTED', `Blocked by Google's safety filter. Not charged. ${reason}`, {
    provider: 'google',
    provider_code: reason,
    retryable: false,
    details: { billed: 'no' },
  });
}

// Build the inline generateContent body for an image, vision or text request.
// Canonical media are referenced by URL; the engine resolves any local input to
// a URL before submit (Google itself does no public-URL fetch, so byte inlining
// happens upstream of this adapter).
function generateContentBody(request: CanonicalRequest): Record<string, unknown> {
  const parts: Array<Record<string, unknown>> = [{ text: request.prompt }];
  for (const media of request.medias) {
    if (media.url) parts.push({ fileData: { fileUri: media.url } });
  }
  const body: Record<string, unknown> = { contents: [{ role: 'user', parts }] };
  const generationConfig: Record<string, unknown> = { responseModalities: ['IMAGE', 'TEXT'] };
  const imageConfig: Record<string, unknown> = {};
  if (request.params.aspect_ratio) imageConfig.aspectRatio = request.params.aspect_ratio;
  if (request.params.resolution) imageConfig.imageSize = request.params.resolution;
  if (Object.keys(imageConfig).length > 0) generationConfig.imageConfig = imageConfig;
  body.generationConfig = generationConfig;
  return body;
}

// Build the Veo predictLongRunning body from the canonical request.
function veoBody(request: CanonicalRequest): Record<string, unknown> {
  const instance: Record<string, unknown> = { prompt: request.prompt };
  const startFrame = request.medias.find((media) => media.role === 'start_frame');
  if (startFrame?.url) instance.image = { fileUri: startFrame.url };
  const parameters: Record<string, unknown> = {};
  if (request.params.aspect_ratio) parameters.aspectRatio = request.params.aspect_ratio;
  if (request.params.resolution) parameters.resolution = request.params.resolution;
  if (request.params.duration_s) parameters.durationSeconds = String(request.params.duration_s);
  if (request.negative_prompt) parameters.negativePrompt = request.negative_prompt;
  if (request.params.seed !== undefined) parameters.seed = request.params.seed;
  return { instances: [instance], parameters };
}

function isVideo(request: CanonicalRequest): boolean {
  return request.capability === 'text2video' || request.capability === 'image2video';
}

// Pull the image and text parts out of a generateContent answer.
function contentOutputs(body: GenerateContentResponse): ProviderOutput[] {
  const parts = body.candidates?.[0]?.content?.parts ?? [];
  const result: ProviderOutput[] = [];
  for (const part of parts) {
    if (part.inlineData?.data)
      result.push({
        kind: 'image',
        base64: part.inlineData.data,
        mime: part.inlineData.mimeType ?? 'image/png',
      });
    else if (part.text) result.push({ kind: 'text', text: part.text, mime: 'text/plain' });
  }
  return result;
}

export const googleAdapter: ProviderAdapter = {
  id: 'google',
  display_name: 'Google',
  base_url: BASE_URL,
  key_detection: {
    pattern: /^AIza[0-9A-Za-z_-]{35}$/,
    confidence: 'high',
    mask: (key) => `${key.slice(0, 6)}••••${key.slice(-4)}`,
  },
  concurrency: { default: 2, max_known: null },
  retention_days: 2,
  training_on_inputs: false,
  supports_authoritative_estimate: false,
  idempotency: 'none',
  async testKey(key, options) {
    const started = performance.now();
    try {
      const response = await requestJson<{ models?: unknown[] }>({
        provider: 'google',
        fetch: options?.fetch ?? fetch,
        ...(options?.signal ? { signal: options.signal } : {}),
        url: `${options?.base_url ?? this.base_url}/models?pageSize=1`,
        init: { headers: headers(key) },
        timeoutMs: 8_000,
      });
      return {
        ok: true,
        latency_ms: Math.round(performance.now() - started),
        model_count: response.models?.length ?? 0,
      };
    } catch (error) {
      return { ok: false, error: this.normalizeError(error) };
    }
  },
  listModels(): Promise<ModelManifest[]> {
    return Promise.resolve(registrySeed.filter((model) => model.provider === 'google'));
  },
  async submit(request, context): Promise<SubmitHandle> {
    const model = request.params.extra?.model;
    if (typeof model !== 'string' || !model)
      throw new KilnryError('INVALID_INPUT', 'A Google model id is required.', { provider: 'google' });

    if (isVideo(request)) {
      const payload = veoBody(request);
      const operation = await requestJson<OperationResponse>({
        provider: 'google',
        fetch: context.fetch,
        signal: context.signal,
        url: `${this.base_url}/models/${model}:predictLongRunning`,
        init: { method: 'POST', headers: headers(context.key), body: JSON.stringify(payload) },
        timeoutMs: 30_000,
        ambiguousOnNetworkError: true,
      });
      if (!operation.name)
        throw new KilnryError('PROVIDER_ERROR', 'Google accepted the video request without an operation.', {
          provider: 'google',
          retryable: true,
        });
      return {
        provider: 'google',
        model_id: model,
        provider_request_id: operation.name,
        status_url: `${this.base_url}/${operation.name}`,
        submitted_at: new Date().toISOString(),
        payload_redacted: redact(payload),
      };
    }

    const payload = generateContentBody(request);
    const body = await requestJson<GenerateContentResponse>({
      provider: 'google',
      fetch: context.fetch,
      signal: context.signal,
      url: `${this.base_url}/models/${model}:generateContent`,
      init: { method: 'POST', headers: headers(context.key), body: JSON.stringify(payload) },
      timeoutMs: 120_000,
    });
    if (body.promptFeedback?.blockReason) throw moderated(body.promptFeedback.blockReason);
    const finish = body.candidates?.[0]?.finishReason;
    if (finish && BLOCKED_FINISH.has(finish)) throw moderated(finish);
    const parsed = contentOutputs(body);
    if (parsed.length === 0)
      throw new KilnryError('PROVIDER_ERROR', 'Google returned no image or text content.', {
        provider: 'google',
        retryable: true,
      });
    const result: ProviderResult = {
      outputs: parsed,
      ...(body.usageMetadata
        ? {
            billing: {
              usage: {
                prompt_tokens: body.usageMetadata.promptTokenCount ?? 0,
                candidates_tokens: body.usageMetadata.candidatesTokenCount ?? 0,
              },
              source: 'usage_metadata',
            },
          }
        : {}),
      raw_redacted: redact(body),
    };
    return {
      provider: 'google',
      model_id: model,
      provider_request_id: `google-${crypto.randomUUID()}`,
      submitted_at: new Date().toISOString(),
      inline_result: result,
      payload_redacted: redact(payload),
    };
  },
  async poll(handle, context) {
    if (handle.inline_result) return { state: 'completed', result: handle.inline_result };
    if (!handle.status_url)
      throw new KilnryError('PROVIDER_ERROR', 'Google video job has no operation URL.', {
        provider: 'google',
      });
    const operation = await requestJson<OperationResponse>({
      provider: 'google',
      fetch: context.fetch,
      signal: context.signal,
      url: handle.status_url,
      init: { headers: headers(context.key) },
    });
    if (!operation.done) return { state: 'running', step_label: 'Rendering at Google Veo' };
    if (operation.error)
      return {
        state: 'failed',
        error: new KilnryError('PROVIDER_ERROR', `Google Veo failed. ${operation.error.message ?? ''}`, {
          provider: 'google',
          retryable: false,
        }),
      };
    const video = operation.response?.generateVideoResponse;
    if ((video?.raiMediaFilteredCount ?? 0) >= 1 && (video?.generatedSamples?.length ?? 0) === 0)
      return {
        state: 'moderated',
        billed: 'no',
        error: new KilnryError(
          'MODERATION_REJECTED',
          "Google's safety filter removed the video. Not charged. Audio filter false positives are common; retry once.",
          { provider: 'google', retryable: true, details: { billed: 'no' } },
        ),
      };
    const uri = video?.generatedSamples?.[0]?.video?.uri;
    if (!uri)
      return {
        state: 'failed',
        error: new KilnryError('PROVIDER_ERROR', 'Google Veo finished without a video.', {
          provider: 'google',
          retryable: true,
        }),
      };
    return {
      state: 'completed',
      result: { outputs: [{ kind: 'video', url: uri, mime: 'video/mp4' }] },
    };
  },
  cancel() {
    return Promise.resolve({ ok: false, reason: 'Google operations cannot be cancelled once submitted.' });
  },
  download(result, context) {
    // Veo file URIs need the API key header to download.
    return downloadOutputs('google', result, context, { 'x-goog-api-key': context.key });
  },
  normalizeError(error) {
    if (error instanceof KilnryError) return error;
    if (error instanceof Response) return providerHttpError('google', error.status, undefined, error.headers);
    return new KilnryError('PROVIDER_ERROR', 'Google returned an unexpected error.', {
      provider: 'google',
      retryable: true,
      cause: error,
    });
  },
};

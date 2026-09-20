// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The MiniMax adapter (TRD-06 §3.6, carries F-PRV-01). Video runs as a task:
// POST /v2/video_generation returns a task id, then GET the task until it
// succeeds and yields a video URL. Text to speech runs synchronously through
// /v1/t2a_v2 and returns the audio as a hex string in the body. MiniMax reports
// moderation and balance problems inside a base_resp.status_code rather than the
// HTTP status, so the adapter reads that envelope: 1026 or 2013 is a
// not-charged moderation rejection and 1008 is out of balance. The key is a
// JWT-shaped bearer token.

import {
  KilnryError,
  redact,
  registrySeed,
  type CanonicalRequest,
  type ModelManifest,
  type ProviderAdapter,
  type ProviderResult,
  type SubmitHandle,
} from '@kilnry/core';
import { downloadOutputs } from '../download.js';
import { requestJson } from '../http.js';

const BASE_URL = 'https://api.minimax.io';

interface BaseResp {
  base_resp?: { status_code?: number; status_msg?: string };
}

interface VideoSubmitResponse extends BaseResp {
  task_id?: string;
}

interface VideoStatusResponse extends BaseResp {
  task_id?: string;
  status?: string;
  file_id?: string;
  video_url?: string;
  duration?: number;
  resolution?: string;
}

interface TtsResponse extends BaseResp {
  data?: { audio?: string; status?: number };
  extra_info?: { audio_length?: number; usage_characters?: number };
}

function headers(key: string): HeadersInit {
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

// MiniMax hides its real outcome in base_resp.status_code. Turn the known codes
// into Kilnry errors; 0 means success.
function checkBaseResp(body: BaseResp): void {
  const code = body.base_resp?.status_code ?? 0;
  const msg = body.base_resp?.status_msg ?? '';
  if (code === 0) return;
  if (code === 1026 || code === 2013)
    throw new KilnryError('MODERATION_REJECTED', `MiniMax rejected the request (${code}). Not charged.`, {
      provider: 'minimax',
      provider_code: String(code),
      retryable: false,
      details: { billed: 'no' },
    });
  if (code === 1008)
    throw new KilnryError('INSUFFICIENT_FUNDS', `MiniMax says your balance is exhausted (1008). ${msg}`, {
      provider: 'minimax',
      provider_code: '1008',
      retryable: false,
    });
  throw new KilnryError('PROVIDER_ERROR', `MiniMax returned status ${code}. ${msg}`, {
    provider: 'minimax',
    provider_code: String(code),
    retryable: true,
  });
}

function isVideo(request: CanonicalRequest): boolean {
  return (
    request.capability === 'text2video' ||
    request.capability === 'image2video' ||
    request.capability === 'reference2video'
  );
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  const out = new Uint8Array(Math.floor(clean.length / 2));
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

export const minimaxAdapter: ProviderAdapter = {
  id: 'minimax',
  display_name: 'MiniMax',
  base_url: BASE_URL,
  key_detection: {
    pattern: /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
    confidence: 'high',
    mask: (key) => `${key.slice(0, 6)}••••${key.slice(-4)}`,
  },
  concurrency: { default: 4, max_known: 30 },
  retention_days: 0,
  training_on_inputs: false,
  supports_authoritative_estimate: false,
  idempotency: 'none',
  async testKey(key, options) {
    const started = performance.now();
    try {
      // A query for a non-existent task returns a JSON envelope (not 401) when
      // the key is valid; an invalid key is rejected before that.
      await requestJson<BaseResp>({
        provider: 'minimax',
        fetch: options?.fetch ?? fetch,
        ...(options?.signal ? { signal: options.signal } : {}),
        url: `${options?.base_url ?? this.base_url}/v1/query/video_generation?task_id=0`,
        init: { headers: headers(key) },
        timeoutMs: 8_000,
      });
      return { ok: true, latency_ms: Math.round(performance.now() - started) };
    } catch (error) {
      return { ok: false, error: this.normalizeError(error) };
    }
  },
  listModels(): Promise<ModelManifest[]> {
    return Promise.resolve(registrySeed.filter((model) => model.provider === 'minimax'));
  },
  async submit(request, context): Promise<SubmitHandle> {
    const model = request.params.extra?.model;
    if (typeof model !== 'string' || !model)
      throw new KilnryError('INVALID_INPUT', 'A MiniMax model id is required.', { provider: 'minimax' });

    if (isVideo(request)) {
      const content: Array<Record<string, unknown>> = [{ type: 'text', text: request.prompt }];
      for (const media of request.medias) {
        if (!media.url) continue;
        content.push({
          type: 'image_url',
          image_url: { url: media.url },
          role: media.role === 'start_frame' ? 'first_frame' : 'reference_image',
        });
      }
      const payload: Record<string, unknown> = {
        model,
        content,
        ...(request.params.resolution ? { resolution: request.params.resolution } : {}),
        ...(request.params.duration_s ? { duration: request.params.duration_s } : {}),
        ratio: 'adaptive',
      };
      const response = await requestJson<VideoSubmitResponse>({
        provider: 'minimax',
        fetch: context.fetch,
        signal: context.signal,
        url: `${this.base_url}/v2/video_generation`,
        init: { method: 'POST', headers: headers(context.key), body: JSON.stringify(payload) },
        timeoutMs: 30_000,
        ambiguousOnNetworkError: true,
      });
      checkBaseResp(response);
      if (!response.task_id)
        throw new KilnryError('PROVIDER_ERROR', 'MiniMax accepted the video without a task id.', {
          provider: 'minimax',
          retryable: true,
        });
      return {
        provider: 'minimax',
        model_id: model,
        provider_request_id: response.task_id,
        status_url: `${this.base_url}/v2/video_generation/${response.task_id}`,
        submitted_at: new Date().toISOString(),
        payload_redacted: redact(payload),
      };
    }

    // Text to speech is synchronous and returns hex audio in the body.
    const voiceId = request.params.voice?.voice_id;
    const payload = {
      model,
      text: request.prompt,
      stream: false,
      ...(voiceId ? { voice_setting: { voice_id: voiceId, speed: 1.0, vol: 1.0, pitch: 0 } } : {}),
      audio_setting: { sample_rate: 32_000, bitrate: 128_000, format: 'mp3', channel: 1 },
    };
    const response = await requestJson<TtsResponse>({
      provider: 'minimax',
      fetch: context.fetch,
      signal: context.signal,
      url: `${this.base_url}/v1/t2a_v2`,
      init: { method: 'POST', headers: headers(context.key), body: JSON.stringify(payload) },
      timeoutMs: 60_000,
    });
    checkBaseResp(response);
    const audioHex = response.data?.audio;
    if (!audioHex)
      throw new KilnryError('PROVIDER_ERROR', 'MiniMax returned no audio.', {
        provider: 'minimax',
        retryable: true,
      });
    const result: ProviderResult = {
      outputs: [{ kind: 'audio', bytes: hexToBytes(audioHex), mime: 'audio/mpeg' }],
      billing: {
        usage: { characters: response.extra_info?.usage_characters ?? request.prompt.length },
        source: 'formula:post',
      },
    };
    return {
      provider: 'minimax',
      model_id: model,
      provider_request_id: `minimax-${crypto.randomUUID()}`,
      submitted_at: new Date().toISOString(),
      inline_result: result,
      payload_redacted: redact({ model, chars: request.prompt.length, voice_id: voiceId }),
    };
  },
  async poll(handle, context) {
    if (handle.inline_result) return { state: 'completed', result: handle.inline_result };
    if (!handle.status_url)
      throw new KilnryError('PROVIDER_ERROR', 'MiniMax video job has no status URL.', {
        provider: 'minimax',
      });
    const status = await requestJson<VideoStatusResponse>({
      provider: 'minimax',
      fetch: context.fetch,
      signal: context.signal,
      url: handle.status_url,
      init: { headers: headers(context.key) },
    });
    const state = status.status?.toLowerCase();
    if (state === 'queued') return { state: 'queued' };
    if (state === 'running' || state === 'processing')
      return { state: 'running', step_label: 'Rendering at MiniMax' };
    if (state === 'cancelled') return { state: 'cancelled' };
    if (state === 'failed')
      return {
        state: 'failed',
        error: new KilnryError('PROVIDER_ERROR', 'MiniMax video generation failed.', {
          provider: 'minimax',
          retryable: true,
        }),
      };
    if (state !== 'succeeded') return { state: 'running', step_label: 'Rendering at MiniMax' };
    const url = status.video_url;
    if (!url)
      return {
        state: 'failed',
        error: new KilnryError('PROVIDER_ERROR', 'MiniMax finished without a video URL.', {
          provider: 'minimax',
          retryable: true,
        }),
      };
    return { state: 'completed', result: { outputs: [{ kind: 'video', url, mime: 'video/mp4' }] } };
  },
  cancel() {
    return Promise.resolve({ ok: false, reason: 'MiniMax tasks cannot be cancelled once submitted.' });
  },
  download(result, context) {
    return downloadOutputs('minimax', result, context, headers(context.key));
  },
  normalizeError(error) {
    return error instanceof KilnryError
      ? error
      : new KilnryError('PROVIDER_ERROR', 'MiniMax returned an unexpected error.', {
          provider: 'minimax',
          retryable: true,
          cause: error,
        });
  },
};

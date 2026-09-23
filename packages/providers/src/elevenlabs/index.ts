// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The ElevenLabs adapter (TRD-06 §3.5, carries F-PRV-01). It turns text into
// speech with a chosen voice through the text-to-speech endpoint, which returns
// audio bytes synchronously; the same adapter powers the voice previews on the
// Voices tab (F-VOI-01), which previously reported that previews had no provider.
// The key is a header, xi-api-key, and the plan is read from the subscription
// endpoint so instant voice cloning can be gated to paid plans later (F-VOI-02).

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
import { providerHttpError } from '../errors.js';
import { requestBytes, requestJson } from '../http.js';
import { downloadOutputs } from '../download.js';

const BASE_URL = 'https://api.elevenlabs.io';
const DEFAULT_TTS_MODEL = 'eleven_flash_v2_5';

function headers(key: string): HeadersInit {
  return { 'xi-api-key': key, 'Content-Type': 'application/json' };
}

// Synthesise a short sample of speech and return the audio bytes. Used by both
// the job path and the Voices-tab preview so a preview never has to pretend.
export async function synthesizeSpeech(options: {
  key: string;
  voice_id: string;
  text: string;
  model_id?: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}): Promise<{ bytes: Uint8Array; mime: string }> {
  return requestBytes({
    provider: 'elevenlabs',
    fetch: options.fetch ?? fetch,
    ...(options.signal ? { signal: options.signal } : {}),
    url: `${BASE_URL}/v1/text-to-speech/${encodeURIComponent(options.voice_id)}?output_format=mp3_44100_128`,
    init: {
      method: 'POST',
      headers: headers(options.key),
      body: JSON.stringify({ text: options.text, model_id: options.model_id ?? DEFAULT_TTS_MODEL }),
    },
    timeoutMs: 60_000,
  });
}

// Dub a source audio or video into another language (TRD-06 §3.5, F-CRE-11). The
// source arrives as a URL and the target language as a provider extra; the dubbed
// audio is returned inline.
async function dubbing(
  request: CanonicalRequest,
  context: { key: string; fetch: typeof fetch; signal: AbortSignal },
  model: string,
): Promise<SubmitHandle> {
  const source = request.medias.find((media) => media.url)?.url;
  if (!source)
    throw new KilnryError('INVALID_INPUT', 'Dubbing needs a source audio or video.', {
      provider: 'elevenlabs',
    });
  const targetLang =
    typeof request.params.extra?.target_language === 'string'
      ? request.params.extra.target_language
      : typeof request.params.extra?.language === 'string'
        ? request.params.extra.language
        : 'en';
  const audio = await requestBytes({
    provider: 'elevenlabs',
    fetch: context.fetch,
    signal: context.signal,
    url: `${BASE_URL}/v1/dubbing`,
    init: {
      method: 'POST',
      headers: { 'xi-api-key': context.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_url: source, target_lang: targetLang, model_id: model }),
    },
    timeoutMs: 300_000,
  });
  const result: ProviderResult = {
    outputs: [{ kind: request.kind === 'video' ? 'video' : 'audio', bytes: audio.bytes, mime: audio.mime }],
    billing: { usage: {}, source: 'formula:post' },
  };
  return {
    provider: 'elevenlabs',
    model_id: model,
    provider_request_id: `elevenlabs-${crypto.randomUUID()}`,
    submitted_at: new Date().toISOString(),
    inline_result: result,
    payload_redacted: redact({ model_id: model, target_lang: targetLang, source }),
  };
}

// Change the voice of a source recording to a chosen voice (TRD-06 §3.5,
// F-CRE-11). The source arrives as a URL and the target voice as a provider
// extra; the converted audio is returned inline.
async function voiceChange(
  request: CanonicalRequest,
  context: { key: string; fetch: typeof fetch; signal: AbortSignal },
): Promise<SubmitHandle> {
  const source = request.medias.find((media) => media.url)?.url;
  if (!source)
    throw new KilnryError('INVALID_INPUT', 'Voice change needs a source recording.', {
      provider: 'elevenlabs',
    });
  const voiceId =
    request.params.voice?.voice_id ??
    (typeof request.params.extra?.voice === 'string' ? request.params.extra.voice : undefined);
  if (typeof voiceId !== 'string' || !voiceId)
    throw new KilnryError('INVALID_INPUT', 'Voice change needs a target voice.', {
      provider: 'elevenlabs',
    });
  const audio = await requestBytes({
    provider: 'elevenlabs',
    fetch: context.fetch,
    signal: context.signal,
    url: `${BASE_URL}/v1/speech-to-speech/${encodeURIComponent(voiceId)}`,
    init: {
      method: 'POST',
      headers: { 'xi-api-key': context.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio_url: source, model_id: 'voice_changer' }),
    },
    timeoutMs: 120_000,
  });
  const result: ProviderResult = {
    outputs: [{ kind: 'audio', bytes: audio.bytes, mime: audio.mime }],
    billing: { usage: {}, source: 'formula:post' },
  };
  return {
    provider: 'elevenlabs',
    model_id: 'voice_changer',
    provider_request_id: `elevenlabs-${crypto.randomUUID()}`,
    submitted_at: new Date().toISOString(),
    inline_result: result,
    payload_redacted: redact({ model_id: 'voice_changer', voice_id: voiceId, source }),
  };
}

export const elevenlabsAdapter: ProviderAdapter = {
  id: 'elevenlabs',
  display_name: 'ElevenLabs',
  base_url: BASE_URL,
  key_detection: {
    pattern: /^sk_[0-9a-f]{48}$/,
    confidence: 'ambiguous',
    mask: (key) => `${key.slice(0, 5)}••••${key.slice(-4)}`,
  },
  concurrency: { default: 2, max_known: 15 },
  retention_days: null,
  training_on_inputs: false,
  supports_authoritative_estimate: false,
  idempotency: 'none',
  async testKey(key, options) {
    const started = performance.now();
    try {
      await requestJson<{ tier?: string }>({
        provider: 'elevenlabs',
        fetch: options?.fetch ?? fetch,
        ...(options?.signal ? { signal: options.signal } : {}),
        url: `${options?.base_url ?? this.base_url}/v1/user/subscription`,
        init: { headers: headers(key) },
        timeoutMs: 8_000,
      });
      return { ok: true, latency_ms: Math.round(performance.now() - started) };
    } catch (error) {
      return { ok: false, error: this.normalizeError(error) };
    }
  },
  listModels(): Promise<ModelManifest[]> {
    return Promise.resolve(registrySeed.filter((model) => model.provider === 'elevenlabs'));
  },
  async submit(request: CanonicalRequest, context) {
    const requestedModel = request.params.extra?.model;
    // Dubbing and voice change are text-to-speech-capability requests tagged in
    // the registry; they are recognised by the model id the transform pins and
    // run against their own endpoints (TRD-06 §3.5, TRD-07 §1, F-CRE-11).
    if (requestedModel === 'dubbing_v1' || requestedModel === 'dubbing_v2') {
      return dubbing(request, context, requestedModel);
    }
    if (requestedModel === 'voice_changer') {
      return voiceChange(request, context);
    }
    if (request.capability !== 'tts')
      throw new KilnryError(
        'NO_PROVIDER',
        'The ElevenLabs adapter synthesises speech; it does not generate images or video.',
        { provider: 'elevenlabs', retryable: false },
      );
    const model = request.params.extra?.model;
    const voiceId = request.params.voice?.voice_id;
    if (typeof voiceId !== 'string' || !voiceId)
      throw new KilnryError('INVALID_INPUT', 'A voice id is required for text to speech.', {
        provider: 'elevenlabs',
      });
    let audio: { bytes: Uint8Array; mime: string };
    try {
      audio = await synthesizeSpeech({
        key: context.key,
        voice_id: voiceId,
        text: request.prompt,
        ...(typeof model === 'string' ? { model_id: model } : {}),
        fetch: context.fetch,
        signal: context.signal,
      });
    } catch (error) {
      throw this.normalizeError(error);
    }
    const result: ProviderResult = {
      outputs: [{ kind: 'audio', bytes: audio.bytes, mime: audio.mime }],
      billing: { usage: { characters: request.prompt.length }, source: 'formula:post' },
    };
    return {
      provider: 'elevenlabs',
      model_id: typeof model === 'string' ? model : DEFAULT_TTS_MODEL,
      provider_request_id: `elevenlabs-${crypto.randomUUID()}`,
      submitted_at: new Date().toISOString(),
      inline_result: result,
      payload_redacted: redact({ voice_id: voiceId, model_id: model, chars: request.prompt.length }),
    };
  },
  poll(handle) {
    if (handle.inline_result) return Promise.resolve({ state: 'completed', result: handle.inline_result });
    return Promise.resolve({
      state: 'failed',
      error: new KilnryError('PROVIDER_ERROR', 'ElevenLabs audio was not returned inline.', {
        provider: 'elevenlabs',
      }),
    });
  },
  cancel() {
    return Promise.resolve({ ok: false, reason: 'ElevenLabs speech completes synchronously.' });
  },
  download(result, context) {
    return downloadOutputs('elevenlabs', result, context);
  },
  normalizeError(error) {
    if (error instanceof KilnryError) return error;
    if (error instanceof Response)
      return providerHttpError('elevenlabs', error.status, undefined, error.headers);
    return new KilnryError('PROVIDER_ERROR', 'ElevenLabs returned an unexpected error.', {
      provider: 'elevenlabs',
      retryable: true,
      cause: error,
    });
  },
};

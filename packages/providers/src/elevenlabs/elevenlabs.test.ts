// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { CanonicalRequestSchema, type AdapterContext, type CanonicalRequest } from '@kilnry/core';
import { elevenlabsAdapter, synthesizeSpeech } from './index.js';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const BASE = 'https://api.elevenlabs.io';
const KEY = ['sk_', 'a'.repeat(48)].join('');
const AUDIO = new Uint8Array([0x49, 0x44, 0x33, 0x04]);

function context(): AdapterContext {
  return { key: KEY, fetch, signal: new AbortController().signal, log: () => undefined };
}

function ttsRequest(): CanonicalRequest {
  return CanonicalRequestSchema.parse({
    kind: 'audio',
    capability: 'tts',
    prompt: 'Hello from Kilnry.',
    params: { voice: { provider: 'elevenlabs', voice_id: 'rachel' }, extra: { model: 'eleven_flash_v2_5' } },
    medias: [],
    injections: [],
    count: 1,
    target_folder: 'inbox',
    source: 'ui',
  });
}

describe('ElevenLabs adapter (F-PRV-01, F-VOI-01)', () => {
  it('testKey succeeds against the subscription endpoint with the xi-api-key header', async () => {
    server.use(
      http.get(`${BASE}/v1/user/subscription`, ({ request }) => {
        expect(request.headers.get('xi-api-key')).toBe(KEY);
        return HttpResponse.json({ tier: 'creator' });
      }),
    );
    const tested = await elevenlabsAdapter.testKey(KEY, { fetch });
    expect(tested.ok).toBe(true);
  });

  it('lists the seeded ElevenLabs models', async () => {
    const manifests = await elevenlabsAdapter.listModels(KEY, { fetch });
    expect(manifests.some((manifest) => manifest.model_id === 'eleven_flash_v2_5')).toBe(true);
  });

  it('synthesises speech to audio bytes through the text-to-speech endpoint', async () => {
    server.use(
      http.post(`${BASE}/v1/text-to-speech/rachel`, () =>
        HttpResponse.arrayBuffer(AUDIO.buffer, { headers: { 'Content-Type': 'audio/mpeg' } }),
      ),
    );
    const handle = await elevenlabsAdapter.submit(ttsRequest(), context());
    const output = handle.inline_result?.outputs[0];
    expect(output?.kind).toBe('audio');
    expect(output?.bytes).toBeInstanceOf(Uint8Array);
  });

  it('synthesizeSpeech returns the audio bytes for a preview', async () => {
    server.use(
      http.post(`${BASE}/v1/text-to-speech/adam`, () =>
        HttpResponse.arrayBuffer(AUDIO.buffer, { headers: { 'Content-Type': 'audio/mpeg' } }),
      ),
    );
    const audio = await synthesizeSpeech({ key: KEY, voice_id: 'adam', text: 'sample', fetch });
    expect(audio.mime).toBe('audio/mpeg');
    expect(audio.bytes.byteLength).toBeGreaterThan(0);
  });

  it('rejects a non-speech capability with NO_PROVIDER', async () => {
    const request = CanonicalRequestSchema.parse({
      kind: 'image',
      capability: 'text2image',
      prompt: 'a kiln',
      params: { extra: { model: 'eleven_flash_v2_5' } },
      medias: [],
      injections: [],
      count: 1,
      target_folder: 'inbox',
      source: 'ui',
    });
    await expect(elevenlabsAdapter.submit(request, context())).rejects.toMatchObject({ code: 'NO_PROVIDER' });
  });

  it('dubs a source video through the dubbing endpoint into audio bytes', async () => {
    server.use(
      http.post(`${BASE}/v1/dubbing`, () =>
        HttpResponse.arrayBuffer(AUDIO.buffer, { headers: { 'Content-Type': 'audio/mpeg' } }),
      ),
    );
    const request = CanonicalRequestSchema.parse({
      kind: 'audio',
      capability: 'tts',
      prompt: 'dubbing',
      params: { extra: { model: 'dubbing_v2', target_language: 'es' } },
      medias: [{ role: 'audio', url: 'https://media.test/clip.mp4' }],
      injections: [],
      count: 1,
      target_folder: 'inbox',
      source: 'ui',
    });
    const handle = await elevenlabsAdapter.submit(request, context());
    expect(handle.model_id).toBe('dubbing_v2');
    expect(handle.inline_result?.outputs[0]?.kind).toBe('audio');
    expect(handle.inline_result?.outputs[0]?.bytes).toBeInstanceOf(Uint8Array);
  });

  it('changes a source recording to a chosen voice through the speech-to-speech endpoint', async () => {
    server.use(
      http.post(`${BASE}/v1/speech-to-speech/rachel`, () =>
        HttpResponse.arrayBuffer(AUDIO.buffer, { headers: { 'Content-Type': 'audio/mpeg' } }),
      ),
    );
    const request = CanonicalRequestSchema.parse({
      kind: 'audio',
      capability: 'tts',
      prompt: 'voice_change',
      params: { voice: { provider: 'elevenlabs', voice_id: 'rachel' }, extra: { model: 'voice_changer' } },
      medias: [{ role: 'audio', url: 'https://media.test/take.wav' }],
      injections: [],
      count: 1,
      target_folder: 'inbox',
      source: 'ui',
    });
    const handle = await elevenlabsAdapter.submit(request, context());
    expect(handle.model_id).toBe('voice_changer');
    expect(handle.inline_result?.outputs[0]?.kind).toBe('audio');
  });

  it('refuses dubbing without a source', async () => {
    const request = CanonicalRequestSchema.parse({
      kind: 'audio',
      capability: 'tts',
      prompt: 'dubbing',
      params: { extra: { model: 'dubbing_v2', target_language: 'es' } },
      medias: [],
      injections: [],
      count: 1,
      target_folder: 'inbox',
      source: 'ui',
    });
    await expect(elevenlabsAdapter.submit(request, context())).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });
});

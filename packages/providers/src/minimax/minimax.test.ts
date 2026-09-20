// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { CanonicalRequestSchema, type AdapterContext, type CanonicalRequest } from '@kilnry/core';
import { minimaxAdapter } from './index.js';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const BASE = 'https://api.minimax.io';
const KEY = ['eyJ', 'a'.repeat(20), '.', 'b'.repeat(20), '.', 'c'.repeat(20)].join('');

function context(): AdapterContext {
  return { key: KEY, fetch, signal: new AbortController().signal, log: () => undefined };
}

function videoRequest(): CanonicalRequest {
  return CanonicalRequestSchema.parse({
    kind: 'video',
    capability: 'text2video',
    prompt: 'a small fox waves at the camera',
    params: { resolution: '768P', duration_s: 10, extra: { model: 'MiniMax-H3' } },
    medias: [],
    injections: [],
    count: 1,
    target_folder: 'inbox',
    source: 'ui',
  });
}

function ttsRequest(): CanonicalRequest {
  return CanonicalRequestSchema.parse({
    kind: 'audio',
    capability: 'tts',
    prompt: 'Aaj ki subah, ek kadak chai.',
    params: {
      voice: { provider: 'minimax', voice_id: 'moss_audio_female' },
      extra: { model: 'speech-2.8-turbo' },
    },
    medias: [],
    injections: [],
    count: 1,
    target_folder: 'inbox',
    source: 'ui',
  });
}

describe('MiniMax adapter (F-PRV-01)', () => {
  it('testKey succeeds against the query endpoint', async () => {
    server.use(
      http.get(`${BASE}/v1/query/video_generation`, ({ request }) => {
        expect(request.headers.get('authorization')).toBe(`Bearer ${KEY}`);
        return HttpResponse.json({ base_resp: { status_code: 0, status_msg: 'success' } });
      }),
    );
    const tested = await minimaxAdapter.testKey(KEY, { fetch });
    expect(tested.ok).toBe(true);
  });

  it('submits a video task and polls until it succeeds', async () => {
    server.use(
      http.post(`${BASE}/v2/video_generation`, () =>
        HttpResponse.json({ task_id: '2891', base_resp: { status_code: 0 } }),
      ),
      http.get(`${BASE}/v2/video_generation/2891`, () =>
        HttpResponse.json({
          task_id: '2891',
          status: 'succeeded',
          file_id: '3311',
          video_url: `${BASE}/files/2891.mp4`,
          duration: 10,
          resolution: '768P',
          base_resp: { status_code: 0 },
        }),
      ),
    );
    const handle = await minimaxAdapter.submit(videoRequest(), context());
    expect(handle.provider_request_id).toBe('2891');
    const poll = await minimaxAdapter.poll(handle, context());
    expect(poll.state).toBe('completed');
    if (poll.state === 'completed') expect(poll.result.outputs[0]?.url).toContain('2891.mp4');
  });

  it('synthesises speech from the hex audio body', async () => {
    server.use(
      http.post(`${BASE}/v1/t2a_v2`, () =>
        HttpResponse.json({
          data: { audio: '49443304', status: 2 },
          extra_info: { audio_length: 2410, usage_characters: 28 },
          base_resp: { status_code: 0 },
        }),
      ),
    );
    const handle = await minimaxAdapter.submit(ttsRequest(), context());
    const output = handle.inline_result?.outputs[0];
    expect(output?.kind).toBe('audio');
    expect(output?.bytes?.byteLength).toBe(4);
  });

  it('maps base_resp 1026 to MODERATION_REJECTED', async () => {
    server.use(
      http.post(`${BASE}/v2/video_generation`, () =>
        HttpResponse.json({ base_resp: { status_code: 1026, status_msg: 'sensitive content' } }),
      ),
    );
    await expect(minimaxAdapter.submit(videoRequest(), context())).rejects.toMatchObject({
      code: 'MODERATION_REJECTED',
    });
  });

  it('maps base_resp 1008 to INSUFFICIENT_FUNDS', async () => {
    server.use(
      http.post(`${BASE}/v2/video_generation`, () =>
        HttpResponse.json({ base_resp: { status_code: 1008, status_msg: 'no balance' } }),
      ),
    );
    await expect(minimaxAdapter.submit(videoRequest(), context())).rejects.toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
    });
  });
});

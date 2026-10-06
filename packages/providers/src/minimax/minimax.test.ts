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

  // F-107: the handler below is MiniMax's own documented V2 query — the route
  // GET /v2/query/video_generation/{task_id} and the envelope { task: { id,
  // model, status, content: { url }, resolution, duration } } copied from
  // https://platform.minimax.io/docs/api-reference/video-generation-v2-query
  // (read 2026-10-06). Nothing answers the path the adapter used to build, so a
  // wrong path or a top-level status read cannot pass.
  it('submits a video task and polls the documented V2 query route until it succeeds', async () => {
    const asked: string[] = [];
    server.use(
      http.post(`${BASE}/v2/video_generation`, () =>
        HttpResponse.json({ task_id: '424010985738629', base_resp: { status_code: 0 } }),
      ),
      http.get(`${BASE}/v2/query/video_generation/:taskId`, ({ params, request }) => {
        asked.push(new URL(request.url).pathname);
        return HttpResponse.json({
          task: {
            id: String(params.taskId),
            model: 'MiniMax-H3',
            status: 'succeeded',
            created_at: 1785125529,
            updated_at: 1785125946,
            content: { url: `${BASE}/files/424010985738629.mp4` },
            resolution: '2K',
            duration: 5,
          },
        });
      }),
    );
    const handle = await minimaxAdapter.submit(videoRequest(), context());
    expect(handle.provider_request_id).toBe('424010985738629');
    expect(handle.status_url).toBe(`${BASE}/v2/query/video_generation/424010985738629`);
    const poll = await minimaxAdapter.poll(handle, context());
    expect(asked).toEqual(['/v2/query/video_generation/424010985738629']);
    expect(poll.state).toBe('completed');
    if (poll.state === 'completed')
      expect(poll.result.outputs[0]?.url).toBe(`${BASE}/files/424010985738629.mp4`);
  });

  it('reports the documented running and failed states from task.status', async () => {
    for (const [status, expected] of [
      ['queued', 'queued'],
      ['running', 'running'],
      ['cancelled', 'cancelled'],
      ['failed', 'failed'],
    ] as const) {
      server.use(
        http.get(`${BASE}/v2/query/video_generation/:taskId`, () =>
          HttpResponse.json({ task: { id: '1', status } }),
        ),
      );
      const poll = await minimaxAdapter.poll(
        {
          provider: 'minimax',
          model_id: 'MiniMax-H3',
          provider_request_id: '1',
          status_url: `${BASE}/v2/query/video_generation/1`,
          submitted_at: new Date().toISOString(),
          payload_redacted: {},
        },
        context(),
      );
      expect(poll.state, status).toBe(expected);
    }
  });

  it('still finishes a legacy V1 handle by fetching the file_id it returns', async () => {
    // The legacy route answers { status: Success, file_id } and the video is
    // fetched from /v1/files/retrieve
    // (https://platform.minimax.io/docs/api-reference/video-generation-query).
    server.use(
      http.get(`${BASE}/v1/query/video_generation`, () =>
        HttpResponse.json({ status: 'Success', file_id: 3311, base_resp: { status_code: 0 } }),
      ),
      http.get(`${BASE}/v1/files/retrieve`, ({ request }) => {
        expect(new URL(request.url).searchParams.get('file_id')).toBe('3311');
        return HttpResponse.json({
          file: { file_id: 3311, download_url: `${BASE}/files/legacy.mp4` },
          base_resp: { status_code: 0 },
        });
      }),
    );
    const poll = await minimaxAdapter.poll(
      {
        provider: 'minimax',
        model_id: 'MiniMax-H3',
        provider_request_id: '3311',
        status_url: `${BASE}/v1/query/video_generation?task_id=3311`,
        submitted_at: new Date().toISOString(),
        payload_redacted: {},
      },
      context(),
    );
    expect(poll.state).toBe('completed');
    if (poll.state === 'completed') expect(poll.result.outputs[0]?.url).toBe(`${BASE}/files/legacy.mp4`);
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

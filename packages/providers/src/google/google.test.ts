// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { CanonicalRequestSchema, type AdapterContext, type CanonicalRequest } from '@kilnry/core';
import { googleAdapter } from './index.js';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const KEY = ['AIza', 'A'.repeat(35)].join('');
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function context(): AdapterContext {
  return { key: KEY, fetch, signal: new AbortController().signal, log: () => undefined };
}

function imageRequest(): CanonicalRequest {
  return CanonicalRequestSchema.parse({
    kind: 'image',
    capability: 'text2image',
    prompt: 'a small ceramic kiln arch on warm paper',
    params: { resolution: '1K', aspect_ratio: '3:4', extra: { model: 'gemini-3.1-flash-image' } },
    medias: [],
    injections: [],
    count: 1,
    target_folder: 'inbox',
    source: 'ui',
  });
}

function videoRequest(): CanonicalRequest {
  return CanonicalRequestSchema.parse({
    kind: 'video',
    capability: 'text2video',
    prompt: 'a paper boat on a monsoon gutter',
    params: { resolution: '720p', duration_s: 8, extra: { model: 'veo-3.1-fast-generate-preview' } },
    medias: [],
    injections: [],
    count: 1,
    target_folder: 'inbox',
    source: 'ui',
  });
}

describe('Google Gemini adapter (F-PRV-01)', () => {
  it('testKey succeeds against the models list', async () => {
    server.use(
      http.get(`${BASE}/models`, ({ request }) => {
        expect(request.headers.get('x-goog-api-key')).toBe(KEY);
        return HttpResponse.json({ models: [{ name: 'models/gemini-3.1-flash-image' }] });
      }),
    );
    const tested = await googleAdapter.testKey(KEY, { fetch });
    expect(tested.ok).toBe(true);
  });

  it('generates an image inline through generateContent', async () => {
    server.use(
      http.post(`${BASE}/models/gemini-3.1-flash-image:generateContent`, () =>
        HttpResponse.json({
          candidates: [
            {
              content: { parts: [{ inlineData: { mimeType: 'image/png', data: TINY_PNG } }] },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: { promptTokenCount: 2318, candidatesTokenCount: 1120, totalTokenCount: 3438 },
        }),
      ),
    );
    const handle = await googleAdapter.submit(imageRequest(), context());
    expect(handle.inline_result?.outputs[0]?.kind).toBe('image');
    expect(handle.inline_result?.outputs[0]?.base64).toBe(TINY_PNG);
    const poll = await googleAdapter.poll(handle, context());
    expect(poll.state).toBe('completed');
  });

  it('maps a promptFeedback block reason to MODERATION_REJECTED', async () => {
    server.use(
      http.post(`${BASE}/models/gemini-3.1-flash-image:generateContent`, () =>
        HttpResponse.json({ promptFeedback: { blockReason: 'SAFETY' } }),
      ),
    );
    await expect(googleAdapter.submit(imageRequest(), context())).rejects.toMatchObject({
      code: 'MODERATION_REJECTED',
    });
  });

  it('maps an unsafe finishReason to MODERATION_REJECTED', async () => {
    server.use(
      http.post(`${BASE}/models/gemini-3.1-flash-image:generateContent`, () =>
        HttpResponse.json({ candidates: [{ finishReason: 'IMAGE_SAFETY' }] }),
      ),
    );
    await expect(googleAdapter.submit(imageRequest(), context())).rejects.toMatchObject({
      code: 'MODERATION_REJECTED',
    });
  });

  it('submits Veo as a long-running operation and polls until the video is ready', async () => {
    const operationName = 'models/veo-3.1-fast-generate-preview/operations/8f0c2d1e';
    server.use(
      http.post(`${BASE}/models/veo-3.1-fast-generate-preview:predictLongRunning`, () =>
        HttpResponse.json({ name: operationName }),
      ),
      http.get(`${BASE}/${operationName}`, () =>
        HttpResponse.json({
          name: operationName,
          done: true,
          response: {
            generateVideoResponse: {
              generatedSamples: [{ video: { uri: `${BASE}/files/abc123:download?alt=media` } }],
              raiMediaFilteredCount: 0,
            },
          },
        }),
      ),
    );
    const handle = await googleAdapter.submit(videoRequest(), context());
    expect(handle.provider_request_id).toBe(operationName);
    expect(handle.inline_result).toBeUndefined();
    const poll = await googleAdapter.poll(handle, context());
    expect(poll.state).toBe('completed');
    if (poll.state === 'completed') {
      expect(poll.result.outputs[0]?.kind).toBe('video');
      expect(poll.result.outputs[0]?.url).toContain('files/abc123');
    }
  });

  it('maps a filtered Veo result to a moderated poll state', async () => {
    const operationName = 'models/veo-3.1-fast-generate-preview/operations/filtered';
    server.use(
      http.post(`${BASE}/models/veo-3.1-fast-generate-preview:predictLongRunning`, () =>
        HttpResponse.json({ name: operationName }),
      ),
      http.get(`${BASE}/${operationName}`, () =>
        HttpResponse.json({
          name: operationName,
          done: true,
          response: { generateVideoResponse: { generatedSamples: [], raiMediaFilteredCount: 1 } },
        }),
      ),
    );
    const handle = await googleAdapter.submit(videoRequest(), context());
    const poll = await googleAdapter.poll(handle, context());
    expect(poll.state).toBe('moderated');
  });
});

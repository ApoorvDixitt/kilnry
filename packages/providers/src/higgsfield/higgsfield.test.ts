// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { CanonicalRequestSchema, type AdapterContext, type CanonicalRequest } from '@kilnry/core';
import { higgsfieldAdapter } from './index.js';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const BASE = 'https://api.higgsfield.ai';
const KEY = ['0'.repeat(8), '-0000-0000-0000-', '0'.repeat(12), ':', 'a'.repeat(24)].join('');
const MODEL = 'kling-video/v3.0/std/image-to-video';

function context(): AdapterContext {
  return { key: KEY, fetch, signal: new AbortController().signal, log: () => undefined };
}

function request(): CanonicalRequest {
  return CanonicalRequestSchema.parse({
    kind: 'video',
    capability: 'image2video',
    prompt: 'a paper boat drifting downstream',
    params: { resolution: '720p', duration_s: 5, extra: { model: MODEL } },
    medias: [{ role: 'start_frame', url: 'https://example.test/first.png' }],
    injections: [],
    count: 1,
    target_folder: 'inbox',
    source: 'ui',
  });
}

describe('Higgsfield adapter (F-PRV-01, opt-in)', () => {
  it('testKey succeeds against the free estimate endpoint with key-pair auth', async () => {
    server.use(
      http.post(`${BASE}/estimate/higgsfield-ai/soul/v2/standard`, ({ request: req }) => {
        expect(req.headers.get('authorization')).toBe(`Key ${KEY}`);
        return HttpResponse.json({ credits: '0.051', usd: '0.0032' });
      }),
    );
    const tested = await higgsfieldAdapter.testKey(KEY, { fetch });
    expect(tested.ok).toBe(true);
  });

  it('submits and polls until completed with a downloadable output', async () => {
    server.use(
      http.post(`${BASE}/${MODEL}`, () =>
        HttpResponse.json({
          status: 'queued',
          request_id: 'f4b1',
          status_url: `${BASE}/requests/f4b1/status`,
          cancel_url: `${BASE}/requests/f4b1/cancel`,
        }),
      ),
      http.get(`${BASE}/requests/f4b1/status`, () =>
        HttpResponse.json({
          request_id: 'f4b1',
          status: 'completed',
          video: { url: `${BASE}/f4b1.mp4` },
          usd: '0.094',
        }),
      ),
    );
    const handle = await higgsfieldAdapter.submit(request(), context());
    expect(handle.provider_request_id).toBe('f4b1');
    const poll = await higgsfieldAdapter.poll(handle, context());
    expect(poll.state).toBe('completed');
    if (poll.state === 'completed') {
      expect(poll.result.outputs[0]?.url).toContain('f4b1.mp4');
      expect(poll.result.billing?.actual_usd).toBe(0.094);
    }
  });

  it('maps a terminal nsfw status to a moderated poll state', async () => {
    server.use(
      http.post(`${BASE}/${MODEL}`, () =>
        HttpResponse.json({
          status: 'queued',
          request_id: 'nsfw1',
          status_url: `${BASE}/requests/nsfw1/status`,
        }),
      ),
      http.get(`${BASE}/requests/nsfw1/status`, () =>
        HttpResponse.json({ request_id: 'nsfw1', status: 'nsfw', payload: null }),
      ),
    );
    const handle = await higgsfieldAdapter.submit(request(), context());
    const poll = await higgsfieldAdapter.poll(handle, context());
    expect(poll.state).toBe('moderated');
  });
});

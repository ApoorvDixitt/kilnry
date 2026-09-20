// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { CanonicalRequestSchema, type AdapterContext, type CanonicalRequest } from '@kilnry/core';
import { openaiAdapter } from './index.js';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const BASE = 'https://api.openai.com/v1';
const KEY = ['sk-proj-', 'A'.repeat(40)].join('');
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function context(): AdapterContext {
  return { key: KEY, fetch, signal: new AbortController().signal, log: () => undefined };
}

function imageRequest(count = 1): CanonicalRequest {
  return CanonicalRequestSchema.parse({
    kind: 'image',
    capability: 'text2image',
    prompt: 'a paper crane on a windowsill',
    params: { width: 1024, height: 1024, quality: 'standard', extra: { model: 'gpt-image-2' } },
    medias: [],
    injections: [],
    count,
    target_folder: 'inbox',
    source: 'ui',
  });
}

describe('OpenAI adapter (F-PRV-01)', () => {
  it('testKey succeeds against the models list', async () => {
    server.use(
      http.get(`${BASE}/models`, ({ request }) => {
        expect(request.headers.get('authorization')).toBe(`Bearer ${KEY}`);
        return HttpResponse.json({ data: [{ id: 'gpt-image-2' }] });
      }),
    );
    const tested = await openaiAdapter.testKey(KEY, { fetch });
    expect(tested.ok).toBe(true);
  });

  it('generates an image inline with the token usage', async () => {
    server.use(
      http.post(`${BASE}/images/generations`, () =>
        HttpResponse.json({
          created: 1_758_197_400,
          data: [{ b64_json: TINY_PNG }],
          usage: {
            total_tokens: 7256,
            input_tokens: 6216,
            output_tokens: 1040,
            input_tokens_details: { image_tokens: 6100, text_tokens: 116 },
          },
        }),
      ),
    );
    const handle = await openaiAdapter.submit(imageRequest(), context());
    expect(handle.inline_result?.outputs[0]?.base64).toBe(TINY_PNG);
    expect(handle.inline_result?.billing?.usage?.image_tokens).toBe(6100);
  });

  it('records how many images the output filter removed when fewer come back', async () => {
    server.use(
      http.post(`${BASE}/images/generations`, () => HttpResponse.json({ data: [{ b64_json: TINY_PNG }] })),
    );
    const handle = await openaiAdapter.submit(imageRequest(4), context());
    const redacted = handle.payload_redacted as { adjustments?: string[] };
    expect(redacted.adjustments?.[0]).toContain('3 of 4 images removed');
  });

  it('maps a 400 moderation_blocked to MODERATION_REJECTED', async () => {
    server.use(
      http.post(`${BASE}/images/generations`, () =>
        HttpResponse.json({ error: { code: 'moderation_blocked', message: 'blocked' } }, { status: 400 }),
      ),
    );
    await expect(openaiAdapter.submit(imageRequest(), context())).rejects.toMatchObject({
      code: 'MODERATION_REJECTED',
    });
  });

  it('rejects video with NO_PROVIDER', async () => {
    const request = CanonicalRequestSchema.parse({
      kind: 'video',
      capability: 'text2video',
      prompt: 'a clip',
      params: { extra: { model: 'gpt-image-2' } },
      medias: [],
      injections: [],
      count: 1,
      target_folder: 'inbox',
      source: 'ui',
    });
    await expect(openaiAdapter.submit(request, context())).rejects.toMatchObject({ code: 'NO_PROVIDER' });
  });
});

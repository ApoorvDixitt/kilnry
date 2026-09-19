// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { delay, http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import {
  CanonicalRequestSchema,
  type AdapterContext,
  type CanonicalRequest,
  type ErrorCode,
} from '@kilnry/core';
import { falAdapter } from './fal/index.js';
import { openRouterAdapter } from './openrouter/index.js';
import { pollinationsAdapter } from './pollinations/index.js';

const server = setupServer();
const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function credential(): string {
  return ['not', 'a', 'real', 'credential'].join('-');
}

function context(signal = new AbortController().signal): AdapterContext {
  return {
    key: credential(),
    fetch,
    signal,
    log: () => undefined,
  };
}

function request(
  provider: 'fal' | 'openrouter',
  capability: 'text2image' | 'text2video' = 'text2image',
): CanonicalRequest {
  const model =
    provider === 'fal'
      ? 'fal-ai/flux-2/klein/4b'
      : capability === 'text2video'
        ? 'bytedance/seedance-2.5'
        : 'bytedance-seed/seedream-4.5';
  return CanonicalRequestSchema.parse({
    kind: capability === 'text2video' ? 'video' : 'image',
    capability,
    prompt: 'fixture request',
    params: {
      width: 1024,
      height: 1024,
      resolution: capability === 'text2video' ? '480p' : '1K',
      duration_s: capability === 'text2video' ? 5 : undefined,
      extra: { model },
    },
    medias: [],
    injections: [],
    count: 1,
    target_folder: 'inbox',
    source: 'ui',
  });
}

async function expectCode(promise: Promise<unknown>, code: ErrorCode): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}

describe('fal adapter MSW matrix', () => {
  it('handles key test, queue success, polling, download, and cancellation', async () => {
    let polls = 0;
    let downloads = 0;
    server.use(
      http.get('https://api.fal.ai/v1/models/pricing', () =>
        HttpResponse.json({
          prices: [
            { endpoint_id: 'fal-ai/flux-2/klein/4b', unit_price: 0.005, unit: 'megapixel', currency: 'USD' },
          ],
        }),
      ),
      http.post('https://queue.fal.run/fal-ai/flux-2/klein/4b', async ({ request: incoming }) => {
        expect(incoming.headers.get('x-fal-store-io')).toBe('0');
        expect(incoming.headers.get('x-fal-object-lifecycle-preference')).toBe(
          '{"expiration_duration_seconds":604800}',
        );
        const payload = (await incoming.json()) as Record<string, unknown>;
        expect(payload).toMatchObject({
          prompt: 'fixture request',
          image_size: { width: 1024, height: 1024 },
        });
        expect(payload).not.toHaveProperty('model');
        expect(payload).not.toHaveProperty('route_why');
        return HttpResponse.json({
          request_id: 'fal-request-fixture',
          status_url: 'https://queue.fal.run/status/fal-request-fixture',
          response_url: 'https://queue.fal.run/result/fal-request-fixture',
          cancel_url: 'https://queue.fal.run/cancel/fal-request-fixture',
        });
      }),
      http.get('https://queue.fal.run/status/fal-request-fixture', () => {
        polls += 1;
        return HttpResponse.json(
          polls === 1
            ? { status: 'IN_QUEUE', queue_position: 2 }
            : polls === 2
              ? { status: 'IN_PROGRESS', logs: [{ message: 'rendering' }] }
              : { status: 'COMPLETED' },
        );
      }),
      http.get('https://queue.fal.run/result/fal-request-fixture', () =>
        HttpResponse.json({
          images: [{ url: 'https://v3b.fal.media/fixture.png', content_type: 'image/png' }],
        }),
      ),
      http.get('https://v3b.fal.media/fixture.png', () => {
        downloads += 1;
        return downloads === 1
          ? HttpResponse.json({ detail: 'temporary CDN failure' }, { status: 503 })
          : new HttpResponse(tinyPng, {
              headers: { 'Content-Type': 'image/png', 'Accept-Ranges': 'bytes' },
            });
      }),
      http.put('https://queue.fal.run/cancel/fal-request-fixture', () =>
        HttpResponse.json({ status: 'CANCELLATION_REQUESTED' }, { status: 202 }),
      ),
    );
    expect((await falAdapter.testKey(credential(), { fetch })).ok).toBe(true);
    expect((await falAdapter.listModels(credential(), { fetch })).length).toBeGreaterThan(50);
    const refreshed = await falAdapter.refreshPrices!(credential(), { fetch });
    expect(refreshed).toMatchObject([
      {
        model_id: 'fal-ai/flux-2/klein/4b',
        price_rule: { kind: 'per_megapixel', per_mp_usd: 0.005 },
      },
    ]);
    await expect(
      falAdapter.authoritativeEstimate!(
        request('fal'),
        {
          estimate_usd: 0.005,
          source: 'formula',
          unit_price: {
            unit: 'megapixel',
            amount_usd: 0.005,
            fetched_at: '2026-09-19T00:00:00.000Z',
            source_url: 'https://fal.ai/models/fal-ai/flux-2/klein/4b',
          },
          breakdown: [{ label: '1 MP', usd: 0.005 }],
          route: {
            provider: 'fal',
            model: 'fal-ai/flux-2/klein/4b',
            why: 'fixture',
          },
          adjustments: [],
          eta_s: 8,
        },
        context(),
      ),
    ).resolves.toBe(0.005);
    const handle = await falAdapter.submit(request('fal'), context());
    expect((await falAdapter.poll(handle, context())).state).toBe('queued');
    expect((await falAdapter.poll(handle, context())).state).toBe('running');
    const terminal = await falAdapter.poll(handle, context());
    expect(terminal.state).toBe('completed');
    if (terminal.state !== 'completed') throw new Error('Expected a completed fal fixture.');
    const downloaded = await falAdapter.download(terminal.result, context());
    expect(downloaded[0]?.bytes).toEqual(new Uint8Array(tinyPng));
    expect(downloads).toBe(2);
    expect(await falAdapter.cancel(handle, context())).toEqual({ ok: true });
  });

  for (const scenario of [
    {
      name: 'moderation',
      status: 422,
      body: { detail: [{ msg: 'flagged by a content checker', type: 'content_policy_violation' }] },
      code: 'MODERATION_REJECTED',
    },
    { name: '429', status: 429, body: { detail: 'slow down' }, code: 'RATE_LIMITED' },
    { name: '5xx', status: 503, body: { detail: 'downstream unavailable' }, code: 'PROVIDER_ERROR' },
    {
      name: 'insufficient funds',
      status: 402,
      body: { detail: 'balance empty' },
      code: 'INSUFFICIENT_FUNDS',
    },
    {
      name: 'insufficient credits on 403',
      status: 403,
      body: { detail: 'credits balance empty' },
      code: 'INSUFFICIENT_FUNDS',
    },
  ] as const) {
    it(`normalizes ${scenario.name}`, async () => {
      server.use(
        http.post('https://queue.fal.run/fal-ai/flux-2/klein/4b', () =>
          HttpResponse.json(scenario.body, { status: scenario.status }),
        ),
      );
      await expectCode(falAdapter.submit(request('fal'), context()), scenario.code);
    });
  }

  it('classifies a submit timeout as ambiguous and never retries inside the adapter', async () => {
    let calls = 0;
    server.use(
      http.post('https://queue.fal.run/fal-ai/flux-2/klein/4b', async () => {
        calls += 1;
        await delay('infinite');
        return HttpResponse.json({});
      }),
    );
    await expectCode(falAdapter.submit(request('fal'), context(AbortSignal.timeout(25))), 'TIMEOUT');
    expect(calls).toBe(1);
  });

  it('classifies a connection reset after submit as ambiguous', async () => {
    let calls = 0;
    server.use(
      http.post('https://queue.fal.run/fal-ai/flux-2/klein/4b', () => {
        calls += 1;
        return HttpResponse.error();
      }),
    );
    await expectCode(falAdapter.submit(request('fal'), context()), 'TIMEOUT');
    expect(calls).toBe(1);
  });

  it('rejects passthrough fields that could replace the canonical fal request', async () => {
    const value = request('fal');
    value.params.extra = { ...value.params.extra, prompt: 'shadow prompt' };
    await expectCode(falAdapter.submit(value, context()), 'INVALID_INPUT');
  });
});

describe('OpenRouter adapter MSW matrix', () => {
  it('handles key test and synchronous image success with authoritative usage.cost', async () => {
    server.use(
      http.get('https://openrouter.ai/api/v1/key', () =>
        HttpResponse.json({ data: { label: 'fixture', limit_remaining: 4.2 } }),
      ),
      http.post('https://openrouter.ai/api/v1/images', () =>
        HttpResponse.json({
          data: [{ b64_json: tinyPng.toString('base64'), media_type: 'image/png' }],
          usage: { cost: 0.04, prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        }),
      ),
      http.get('https://openrouter.ai/api/v1/images/models', () => HttpResponse.json({ data: [] })),
      http.get('https://openrouter.ai/api/v1/videos/models', () => HttpResponse.json({ data: [] })),
    );
    const tested = await openRouterAdapter.testKey(credential(), { fetch });
    expect(tested).toMatchObject({ ok: true, balance_usd: 4.2 });
    expect((await openRouterAdapter.listModels(credential(), { fetch })).length).toBeGreaterThan(20);
    const handle = await openRouterAdapter.submit(request('openrouter'), context());
    expect(handle.inline_result?.billing?.actual_usd).toBe(0.04);
    const downloaded = await openRouterAdapter.download(handle.inline_result!, context());
    expect(downloaded[0]?.mime).toBe('image/png');
  });

  it('accepts the current pending/polling_url/unsigned_urls video contract', async () => {
    let polls = 0;
    server.use(
      http.post('https://openrouter.ai/api/v1/videos', () =>
        HttpResponse.json(
          {
            id: 'video-fixture',
            polling_url: 'https://openrouter.ai/api/v1/videos/video-fixture',
            status: 'pending',
          },
          { status: 202 },
        ),
      ),
      http.get('https://openrouter.ai/api/v1/videos/video-fixture', () => {
        polls += 1;
        return HttpResponse.json(
          polls === 1
            ? { id: 'video-fixture', status: 'pending' }
            : {
                id: 'video-fixture',
                status: 'completed',
                unsigned_urls: ['https://openrouter.ai/api/v1/videos/video-fixture/content?index=0'],
                usage: { cost: 0.52 },
              },
        );
      }),
      http.get(
        'https://openrouter.ai/api/v1/videos/video-fixture/content',
        () =>
          new HttpResponse(Uint8Array.from([0, 0, 0, 20, 102, 116, 121, 112]), {
            headers: { 'Content-Type': 'video/mp4' },
          }),
      ),
    );
    const handle = await openRouterAdapter.submit(request('openrouter', 'text2video'), context());
    expect((await openRouterAdapter.poll(handle, context())).state).toBe('queued');
    const terminal = await openRouterAdapter.poll(handle, context());
    expect(terminal.state).toBe('completed');
    if (terminal.state !== 'completed') throw new Error('Expected a completed OpenRouter video fixture.');
    expect(terminal.result.billing?.actual_usd).toBe(0.52);
    expect((await openRouterAdapter.download(terminal.result, context()))[0]?.mime).toBe('video/mp4');
  });

  it('maps live image, video, and token prices into registry updates', async () => {
    server.use(
      http.get('https://openrouter.ai/api/v1/images/models', () =>
        HttpResponse.json({
          data: [
            {
              id: 'bytedance-seed/seedream-4.5',
              endpoints: '/api/v1/images/models/bytedance-seed/seedream-4.5/endpoints',
            },
          ],
        }),
      ),
      http.get('https://openrouter.ai/api/v1/images/models/bytedance-seed/seedream-4.5/endpoints', () =>
        HttpResponse.json({
          endpoints: [
            {
              pricing: [{ billable: 'output_image', cost_usd: 0.055, unit: 'image' }],
            },
          ],
        }),
      ),
      http.get('https://openrouter.ai/api/v1/videos/models', () =>
        HttpResponse.json({
          data: [{ id: 'bytedance/seedance-2.5', pricing_skus: { video_tokens: '0.000012' } }],
        }),
      ),
      http.get('https://openrouter.ai/api/v1/models', () =>
        HttpResponse.json({
          data: [
            {
              id: 'anthropic/claude-sonnet-5',
              pricing: { prompt: '0.000003', completion: '0.000015' },
            },
          ],
        }),
      ),
    );
    const updates = await openRouterAdapter.refreshPrices!(credential(), { fetch });
    expect(updates.find((update) => update.model_id === 'bytedance-seed/seedream-4.5')).toMatchObject({
      price_rule: { kind: 'flat_per_unit', amount: 0.055 },
    });
    expect(updates.find((update) => update.model_id === 'bytedance/seedance-2.5')).toMatchObject({
      price_rule: { kind: 'video_tokens', usd_per_token: { default: 0.000012 } },
    });
    expect(updates.find((update) => update.model_id === 'anthropic/claude-sonnet-5')).toMatchObject({
      price_rule: { kind: 'per_million_tokens', in: 3, out: 15 },
    });
  });

  for (const scenario of [
    {
      name: 'moderation',
      status: 403,
      body: { error: { code: 403, message: 'blocked', metadata: { reasons: ['policy'] } } },
      code: 'MODERATION_REJECTED',
    },
    { name: '429', status: 429, body: { error: { code: 429, message: 'slow down' } }, code: 'RATE_LIMITED' },
    {
      name: '5xx',
      status: 502,
      body: { error: { code: 502, message: 'upstream down' } },
      code: 'PROVIDER_ERROR',
    },
    {
      name: 'insufficient funds',
      status: 402,
      body: { error: { code: 402, message: 'credits empty' } },
      code: 'INSUFFICIENT_FUNDS',
    },
    {
      name: 'insufficient credits on 403',
      status: 403,
      body: { error: { code: 403, message: 'credit balance empty' } },
      code: 'INSUFFICIENT_FUNDS',
    },
  ] as const) {
    it(`normalizes ${scenario.name}`, async () => {
      server.use(
        http.post('https://openrouter.ai/api/v1/images', () =>
          HttpResponse.json(scenario.body, { status: scenario.status }),
        ),
      );
      await expectCode(openRouterAdapter.submit(request('openrouter'), context()), scenario.code);
    });
  }

  it('does not retry timeout or ambiguous-submit failures', async () => {
    let timeoutCalls = 0;
    server.use(
      http.post('https://openrouter.ai/api/v1/images', async () => {
        timeoutCalls += 1;
        await delay('infinite');
        return HttpResponse.json({});
      }),
    );
    await expectCode(
      openRouterAdapter.submit(request('openrouter'), context(AbortSignal.timeout(25))),
      'TIMEOUT',
    );
    expect(timeoutCalls).toBe(1);

    server.resetHandlers();
    let ambiguousCalls = 0;
    server.use(
      http.post('https://openrouter.ai/api/v1/images', () => {
        ambiguousCalls += 1;
        return HttpResponse.error();
      }),
    );
    await expectCode(openRouterAdapter.submit(request('openrouter'), context()), 'TIMEOUT');
    expect(ambiguousCalls).toBe(1);
  });

  it('rejects passthrough fields that could replace the canonical OpenRouter request', async () => {
    const value = request('openrouter');
    value.params.extra = { ...value.params.extra, prompt: 'shadow prompt' };
    await expectCode(openRouterAdapter.submit(value, context()), 'INVALID_INPUT');
  });
});

describe('Pollinations demo adapter', () => {
  it('tests a free key, generates one image, and records zero provider cost', async () => {
    server.use(
      http.get('https://gen.pollinations.ai/v1/models', () => HttpResponse.json({ data: [{ id: 'flux' }] })),
      http.post('https://gen.pollinations.ai/v1/images/generations', () =>
        HttpResponse.json({
          data: [{ b64_json: tinyPng.toString('base64'), media_type: 'image/png' }],
        }),
      ),
    );
    const demoRequest = CanonicalRequestSchema.parse({
      kind: 'image',
      capability: 'text2image',
      prompt: 'free demo fixture',
      params: { width: 1024, height: 1024, resolution: '1K', extra: { model: 'flux' } },
      medias: [],
      injections: [],
      count: 1,
      target_folder: 'inbox',
      source: 'ui',
    });
    expect(await pollinationsAdapter.testKey(credential(), { fetch })).toMatchObject({ ok: true });
    const handle = await pollinationsAdapter.submit(demoRequest, context());
    expect(handle.inline_result?.billing).toMatchObject({ actual_usd: 0, source: 'free' });
    expect((await pollinationsAdapter.download(handle.inline_result!, context()))[0]?.bytes).toEqual(
      new Uint8Array(tinyPng),
    );
  });

  it('maps an exhausted free-key balance to insufficient funds', async () => {
    server.use(
      http.post('https://gen.pollinations.ai/v1/images/generations', () =>
        HttpResponse.json({ error: { message: 'credit balance empty' } }, { status: 402 }),
      ),
    );
    const demoRequest = CanonicalRequestSchema.parse({
      kind: 'image',
      capability: 'text2image',
      prompt: 'free demo fixture',
      params: { extra: { model: 'flux' } },
      medias: [],
      injections: [],
      count: 1,
      target_folder: 'inbox',
      source: 'ui',
    });
    await expectCode(pollinationsAdapter.submit(demoRequest, context()), 'INSUFFICIENT_FUNDS');
  });
});

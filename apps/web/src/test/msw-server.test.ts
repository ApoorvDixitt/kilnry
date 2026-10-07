// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The acceptance suite's provider fixtures must answer in each provider's
// documented shape (D-57), or a scenario passes on a path the real provider
// never takes. These drive the real adapters against the fixtures.

import { beforeAll, describe, expect, it } from 'vitest';
import { extractProduct, safeFetch } from '@kilnry/core';
import { adapters } from '@kilnry/providers';
import { startTestMsw } from './msw-server';

beforeAll(() => {
  startTestMsw();
});

const context = {
  key: 'test-key',
  fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
  signal: new AbortController().signal,
};

// F-99: the Higgsfield status fixture returned `results[]`, a key the adapter
// never reads, so a completed job in the suite failed as "no downloadable
// output". The documented completed payload is `images[{url}]`, `video{url}`
// or `audio{url}` (https://docs.higgsfield.ai/docs/concepts/requests.md, as
// recorded in 04-reference/providers-models-pricing-2026-09.md:475).
describe('Higgsfield status fixture (F-PRV-01, F-99)', () => {
  it('completes a Soul 2 job with one image the adapter can download', async () => {
    const result = await adapters.higgsfield!.poll(
      { request_id: 'hf_req_1', status_url: 'https://api.higgsfield.ai/requests/hf_req_1/status' } as never,
      context as never,
    );
    expect(result.state).toBe('completed');
    expect((result as { result: { outputs: Array<{ kind: string; url: string }> } }).result.outputs).toEqual([
      expect.objectContaining({ kind: 'image', url: expect.stringMatching(/^https:\/\//) }),
    ]);
  });
});

// F-93 / F-94: the fal status fixture answered COMPLETED on the first poll with
// no logs, so the queued → running progression and the step label the adapter
// takes from fal's logs never ran in the suite.
describe('fal queue status fixture (F-JOB-01, F-93, F-94)', () => {
  it('goes IN_QUEUE, then IN_PROGRESS with a log line, then COMPLETED', async () => {
    const handle = {
      request_id: 'kilnry-progress-1',
      status_url: 'https://queue.fal.run/fal-ai/flux/requests/kilnry-progress-1/status',
      response_url: 'https://queue.fal.run/fal-ai/flux/requests/kilnry-progress-1',
    };
    const queued = await adapters.fal!.poll(handle as never, context as never);
    expect(queued).toMatchObject({ state: 'queued', position: 1 });
    const running = await adapters.fal!.poll(handle as never, context as never);
    expect(running).toMatchObject({
      state: 'running',
      step_label: 'Rendering at fal',
      logs: ['Rendering at fal'],
    });
    const done = await adapters.fal!.poll(handle as never, context as never);
    expect(done.state).toBe('completed');
  });
});

// F-92: PRD-14 §11 criterion 1 — every §1 provider connects with its documented
// test call in the MSW-mocked suite. OpenAI, Replicate and Google had no
// handler in this server, so their calls reached onUnhandledRequest's error.
describe('OpenAI, Replicate and Google fixtures (F-PRV-01, F-92)', () => {
  const run = { ...context };
  const base = {
    kind: 'image',
    prompt: 'a small tin lantern on a windowsill',
    count: 1,
    medias: [],
    params: { aspect_ratio: '1:1' },
  };

  it('each answers its test call', async () => {
    for (const id of ['openai', 'replicate', 'google'] as const) {
      const tested = await adapters[id]!.testKey('test-key', { fetch: context.fetch });
      expect(tested, id).toMatchObject({ ok: true });
    }
  });

  it('OpenAI generates an inline image', async () => {
    const handle = await adapters.openai!.submit(
      {
        ...base,
        capability: 'text2image',
        params: { ...base.params, extra: { model: 'gpt-image-2' } },
      } as never,
      run as never,
    );
    const result = await adapters.openai!.poll(handle, run as never);
    expect(result.state).toBe('completed');
  });

  it('Google generates a Gemini image inline and a Veo video through an operation', async () => {
    const image = await adapters.google!.submit(
      {
        ...base,
        capability: 'text2image',
        params: { ...base.params, extra: { model: 'gemini-3.1-flash-image' } },
      } as never,
      run as never,
    );
    expect((await adapters.google!.poll(image, run as never)).state).toBe('completed');
    const video = await adapters.google!.submit(
      {
        ...base,
        kind: 'video',
        capability: 'text2video',
        params: { ...base.params, duration_s: 4, extra: { model: 'veo-3.1-fast-generate-preview' } },
      } as never,
      run as never,
    );
    const done = await adapters.google!.poll(video, run as never);
    expect(done).toMatchObject({ state: 'completed' });
    const url = (done as { result: { outputs: Array<{ url: string }> } }).result.outputs[0]!.url;
    expect((await fetch(url)).headers.get('content-type')).toBe('video/mp4');
  });

  it('Replicate trains through processing to a version', async () => {
    const handle = await adapters.replicate!.submit(
      {
        ...base,
        kind: 'training',
        capability: 'train_lora',
        params: { extra: { model: 'ostris/flux-dev-lora-trainer/fixture', training_input: { steps: 1000 } } },
      } as never,
      run as never,
    );
    expect(await adapters.replicate!.poll(handle, run as never)).toMatchObject({ state: 'running' });
    const done = await adapters.replicate!.poll(handle, run as never);
    expect(done.state).toBe('completed');
  });
});

// F-97: the suite's OpenRouter catalogues answered `{ data: [] }` for the LLM
// list and had no token-priced video row, so the token branches of the price
// refresh (`withTokenPricing`, `withVideoPricing`'s video_tokens SKU) ran
// against nothing.
describe('OpenRouter price catalogue fixture (F-PRV-07, F-97)', () => {
  it('refreshes a token-priced video model and a language model from the documented rows', async () => {
    const updates = await adapters.openrouter!.refreshPrices!('test-key', { fetch: context.fetch });
    const byId = new Map(updates.map((update) => [update.model_id, update]));
    expect(byId.get('bytedance/seedance-2.0-fast')).toMatchObject({
      price_rule: { kind: 'video_tokens', usd_per_token: { default: 0.0000042 } },
      source_url: 'https://openrouter.ai/api/v1/videos/models',
    });
    expect(byId.get('openai/gpt-5.6-luna')).toMatchObject({
      price_rule: { kind: 'per_million_tokens', in: 0.2, out: 1.2 },
      source_url: 'https://openrouter.ai/api/v1/models',
    });
  });
});

// F-98: the suite's OpenRouter image handler only ever answered a success, so
// OpenRouter's documented moderation answers — 403 with `metadata.reasons` for
// an image, a `failed` job with the provider's safety text for a video — never
// reached the adapter.
describe('OpenRouter moderation fixture (F-CRE-14, F-98)', () => {
  it('refuses a flagged image with 403 metadata.reasons: blocked, not charged', async () => {
    const refused = adapters.openrouter!.submit(
      {
        kind: 'image',
        capability: 'text2image',
        prompt: 'a TRIGGER scene the checker rejects',
        count: 1,
        medias: [],
        params: { aspect_ratio: '1:1', extra: { model: 'bytedance-seed/seedream-4.5' } },
      } as never,
      context as never,
    );
    await expect(refused).rejects.toMatchObject({
      code: 'MODERATION_REJECTED',
      options: expect.objectContaining({
        provider_code: 'moderation',
        details: expect.objectContaining({ http_status: 403, billed: 'no' }),
      }),
    });
  });

  it('a flagged video finishes moderated with the provider text, not charged', async () => {
    const handle = await adapters.openrouter!.submit(
      {
        kind: 'video',
        capability: 'text2video',
        prompt: 'a TRIGGER scene the checker rejects',
        count: 1,
        medias: [],
        params: { aspect_ratio: '16:9', duration_s: 5, extra: { model: 'bytedance/seedance-2.0-fast' } },
      } as never,
      context as never,
    );
    const result = await adapters.openrouter!.poll(handle, context as never);
    expect(result).toMatchObject({ state: 'moderated', billed: 'no' });
  });
});

// The UX audit addendum: Element from a product URL had no product-page
// fixture, so the path could not be walked under MSW. The page is read the way
// the fetch route reads it — safeFetch, then extractProduct.
describe('product page fixture (F-CHR-02, Element from URL)', () => {
  it('serves a product page safeFetch reads and extractProduct understands', async () => {
    const url = 'https://example.com/kilnry-fixture/chai-masala';
    const response = await safeFetch(url, { max_bytes: 5 * 1024 * 1024 });
    expect(response.status).toBe(200);
    const facts = extractProduct(await response.text(), url);
    expect(facts).toMatchObject({ title: 'Kilnry Chai Masala', price: '249 INR', brand: 'Kilnry Kitchen' });
    expect(facts.claims).toEqual(
      expect.arrayContaining(['Certified organic cardamom and ginger', 'Free from added sugar']),
    );
  });
});

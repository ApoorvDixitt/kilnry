// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAACXBIWXMAAAsTAAALEwEAmpwYAAAFLUlEQVR4nO2b224bVRSGfc3hjQovwFXhNShCQtxw016DuCwSgdKqCT1ElCCaVhUC6iatnbSpjVfaom3XceyMMxjl4HmChdZISChqZJrM9p7xfBdLshI5s2etL3uvw78rSSyKSWl9UAm9AEwAAAiEHQAIhCMACIQcAAiEJBAIhCoACIQyEAiEPgAQCI0gIBA6gUAgtIKBQJgFAIEwDAICYRoIBMI4GAgEPQAQCIIQIBAUQUAgSMKAQNAEFhWCa49u6JmLH+ob58+mdubiOb1RW2QYVAb7+NbnWvnsvVfaJ0tfMAya9f/8yjHB/9du1m56ez6y8DgsALbtTwLgna8+AoBZtTfPn50IwFsX3geAkzr4MHqqo/Z9HT67o/3GD9qtL+jLR1e0s3JJ2w/mUrPP9jP7Xb9xS4fP7urf7Wr63TwA8PaFDwDgdZy616tp1PpZt+rz6qpfn8q26vMatW6nf9PPEXBuIgDvcgRMduR42NDd5/e0W7t66qC7Y6xbm0+fMR42MwPASr1JACzW/ZWDhU8CD4cNHW7eSbdxX4F3R8yeNdy8mz47i3ewUu+44H+69KVX/xUagL/cb9pZnV7g3StA2H3xiyZx69TvYqWeZfuWE5jZtu/zP7/QABz0H2tv/VqwwLsj1lu/nq4ptF9KAcCoU9X2yrfBg+6OmK1p5O4H988MA9BKM/vQgXYTzCqGLI4EAPiPE8ZxK63PQwfX/U+ztY53iwFBpQjB336yGDyo7jVte2OxEBDkHoBB48fgwXSn2AnyfhzkGoAinPlugkVyOxe+LBwA1r8PHTyXkY3c78H9WSgArKZur+av1HMnNHuXg0E++wS5BCBPTR6Xkdk7hfZrIQCI//w1eLCcJ7PWdWj/5hoAG66E7O07z9ZZ/S7TSeLMAWBTvdBBcp7NxCah/ZxLAGyeP82RbrBdYOVSrnaB3ABgQovQwXFTst0X94L7O3cAZCHfKop1a/PB/Z0rAExvFzoobsq2v10P7vfcADALLV9X0BZxpUzbvyVgO80lHbWrut9f1/Hwj9TsswlNBs2lqSWi3bWF4H7PBQCmvfft7PaDbzSS5bTSmLSecdTUaHM5/Y7fdc3pYZSNqLTQAPge+nQeXj7RebvXq+nLh5e9rm3UCS8hCw6A3djxGfyDnY0Tr+1wZ8MrBHloCgUHwJfUy7bwLDLtvV7N23EweGqCkZIDsLW24MW5duZntcZoc9nLGrfWvgcAu5Tpp92aXYI1jppeqgN796TsO4APx+40f8p8nYNm9tpEm3wmZQegXZ3L3LFW52e9zlGnmvk6LbdIyg5A1k4183FNa7+/7mWtof0/kwD4GLeOh00AKAoARYI1YQcojlNdgdZa6iOAtQoAlB3WhB0AABKOAHaAhByAIyAhCSQHSKgCSAITykCqgIQ+AGVgQiOIPkBCJ5BGEK3gmE4gs4CYVjDDoJhZANPAmGEQ4+CYaSB6gJhxMIKQGD0AiqAYQQiSsBhFEJrAGEkYotAYTSBK2xhRaOmVtg5VcLmVtq5Aa0UWDgCKLJwdQJGFcwQosnByAEUWThKoyMKpAhRZOGWgIgunD6DIwmkEaS5k4ZiUuxOICQAAgbADAIFwBACBkAMAgZAEAoFQBQCBUAYCgdAHAAKhEQQEQicQCIRWMBAIswAgEIZBQCBMA4FAGAcDgaAHAAJBEAIEgiIICARJGBAImkAgEEShQCCogoFAkIUDgXAvAAiEiyFAINwMAgLhahgQCHcDgUC4HAoEwu1gIJDUB/8AdbkgI99wwUMAAAAASUVORK5CYII=',
  'base64',
);

const mp4 = Buffer.from(
  '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',
  'base64',
);
// A single HTTPS location the fal video fixture points at; the engine downloads
// the bytes from here after the queue job completes.
const FAL_VIDEO_URL = 'https://v3.fal.media/files/test/kilnry-fixture.mp4';

type TestGlobal = typeof globalThis & {
  __kilnryTestMswStarted?: boolean;
  __kilnryTestMswServer?: ReturnType<typeof setupServer>;
};

export function startTestMsw(): void {
  const global = globalThis as TestGlobal;
  if (global.__kilnryTestMswStarted) return;
  const server = setupServer(
    http.get('https://openrouter.ai/api/v1/key', () =>
      HttpResponse.json({ data: { label: 'Kilnry test', limit_remaining: 10 } }),
    ),
    http.post('https://openrouter.ai/api/v1/images', () =>
      HttpResponse.json({
        data: [{ b64_json: png.toString('base64'), media_type: 'image/png' }],
        usage: { cost: 0.014, prompt_tokens: 20, completion_tokens: 100, total_tokens: 120 },
      }),
    ),
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
        endpoints: [{ pricing: [{ billable: 'output_image', cost_usd: 0.04, unit: 'image' }] }],
      }),
    ),
    http.get('https://openrouter.ai/api/v1/videos/models', () => HttpResponse.json({ data: [] })),
    http.get('https://openrouter.ai/api/v1/models', () => HttpResponse.json({ data: [] })),
    http.get('https://api.fal.ai/v1/models/pricing', () =>
      HttpResponse.json({
        prices: [
          {
            endpoint_id: 'fal-ai/flux-2/klein/4b',
            unit_price: 0.005,
            unit: 'megapixel',
            currency: 'USD',
          },
          {
            endpoint_id: 'fal-ai/kling-video/v3/standard/text-to-video',
            unit_price: 0.05,
            unit: 'second',
            currency: 'USD',
          },
        ],
      }),
    ),
    // fal is a queue provider: submit returns a request id and polling URLs, the
    // status turns to COMPLETED, and the response carries a downloadable output.
    // A prompt containing TRIGGER is rejected exactly as S-09 states: HTTP 422
    // with detail[].type "content_policy_violation" and X-Fal-Retryable: false,
    // so the job is moderated and never billed.
    http.post('https://queue.fal.run/*', async ({ request }) => {
      const body = (await request
        .clone()
        .json()
        .catch(() => ({}))) as { prompt?: string };
      if (typeof body.prompt === 'string' && body.prompt.includes('TRIGGER')) {
        return HttpResponse.json(
          {
            detail: [
              { msg: 'The prompt was flagged by a content checker.', type: 'content_policy_violation' },
            ],
          },
          { status: 422, headers: { 'X-Fal-Retryable': 'false' } },
        );
      }
      const requestId = `kilnry-${crypto.randomUUID()}`;
      const url = new URL(request.url);
      const model = url.pathname.replace(/^\//, '');
      return HttpResponse.json({
        request_id: requestId,
        status_url: `https://queue.fal.run/${model}/requests/${requestId}/status`,
        response_url: `https://queue.fal.run/${model}/requests/${requestId}`,
      });
    }),
    http.get('https://queue.fal.run/*/requests/*/status', () =>
      HttpResponse.json({ status: 'COMPLETED', logs: [] }),
    ),
    http.get('https://queue.fal.run/*/requests/*', ({ request }) => {
      const isVideo = /video|kling|veo|seedance/i.test(new URL(request.url).pathname);
      return isVideo
        ? HttpResponse.json({ video: { url: FAL_VIDEO_URL, content_type: 'video/mp4' } })
        : HttpResponse.json({
            images: [{ url: FAL_VIDEO_URL.replace('.mp4', '.png'), content_type: 'image/png' }],
          });
    }),
    http.get(FAL_VIDEO_URL, () =>
      HttpResponse.arrayBuffer(mp4.buffer.slice(mp4.byteOffset, mp4.byteOffset + mp4.byteLength), {
        headers: { 'Content-Type': 'video/mp4' },
      }),
    ),
    http.get(FAL_VIDEO_URL.replace('.mp4', '.png'), () =>
      HttpResponse.arrayBuffer(png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength), {
        headers: { 'Content-Type': 'image/png' },
      }),
    ),
    http.get('https://gen.pollinations.ai/v1/models', () => HttpResponse.json({ data: [{ id: 'flux' }] })),
    http.post('https://gen.pollinations.ai/v1/images/generations', () =>
      HttpResponse.json({ data: [{ b64_json: png.toString('base64'), media_type: 'image/png' }] }),
    ),
  );
  server.listen({ onUnhandledRequest: 'error' });
  global.__kilnryTestMswServer = server;
  global.__kilnryTestMswStarted = true;
}

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { falEndpointSchema } from '@kilnry/providers';
import { chatCompletionHandler } from './chat-openrouter-fixture';
import { consistencyFixtureHandlers } from './consistency-fixture';

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
const FAL_AUDIO_URL = 'https://v3.fal.media/files/test/kilnry-fixture.mp3';
// Where a completed fal LoRA training points at its safetensors file (F-CHR-07).
const FAL_LORA_URL = 'https://v3.fal.media/files/test/kilnry-lora.safetensors';
// Where a completed fal image-to-3D job points at its GLB (F-CRE-15).
const FAL_GLB_URL = 'https://v3.fal.media/files/test/kilnry-fixture.glb';
// Where a completed Veo operation points at its video (F-92).
const GOOGLE_VIDEO_URL = 'https://generativelanguage.googleapis.com/v1beta/files/kilnry-fixture:download';

// A valid binary glTF holding one triangle, so the finalizer embeds its metadata
// and the viewer tile can actually draw it (F-CRE-15).
function triangleGlb(): Buffer {
  const positions = Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);
  const json = Buffer.from(
    JSON.stringify({
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      ],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.length }],
      buffers: [{ byteLength: positions.length }],
    }),
    'utf8',
  );
  const jsonLength = Math.ceil(json.length / 4) * 4;
  const binLength = Math.ceil(positions.length / 4) * 4;
  const output = Buffer.alloc(12 + 8 + jsonLength + 8 + binLength, 0);
  output.write('glTF', 0, 'ascii');
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(jsonLength, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  output.fill(0x20, 20, 20 + jsonLength);
  json.copy(output, 20);
  const binStart = 20 + jsonLength;
  output.writeUInt32LE(binLength, binStart);
  output.writeUInt32LE(0x004e4942, binStart + 4);
  positions.copy(output, binStart + 8);
  return output;
}
const glb = triangleGlb();

// The bytes the speech and voice fixtures return. A real one-second MP3 is built
// once with ffmpeg so the finalizer can probe its duration the way it would for a
// provider's own file; if ffmpeg is unavailable a single silent frame stands in.
const SILENT_MP3_FRAME = Buffer.from(
  'SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjYyLjMuMTAwAAAAAAAAAAAAAAD/+xDEAAPAAAGkAAAAIAAANIAAAAT/',
  'base64',
);

function fixtureMp3(): Buffer {
  const path = join(tmpdir(), 'kilnry-fixture-speech-1s.mp3');
  try {
    if (!existsSync(path)) {
      execFileSync(
        process.env.KILNRY_FFMPEG ?? 'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=440:duration=1',
          '-c:a',
          'libmp3lame',
          '-b:a',
          '32k',
          '-y',
          path,
        ],
        { stdio: 'ignore' },
      );
    }
    return readFileSync(path);
  } catch {
    return SILENT_MP3_FRAME;
  }
}

const mp3 = fixtureMp3();
// A tiny fixture safetensors payload (bytes only; the trainer verifies its hash).
const safetensors = Buffer.from('safetensors-fixture-bytes');

// The ambiguous-timeout scenario (S-11) needs a MiniMax video task that hangs
// past the poll timeout and then reports Success on the same task id. The task
// counter and a per-task poll count live on globalThis so they survive any
// module re-evaluation during the dev server's lifetime. When a short test
// timeout is set, the first few polls report Processing (so the first job's poll
// loop reaches its timeout) and later polls report Success (so a Check status on
// the same task id finds it finished) — deterministic and independent of
// wall-clock timing.
const MINIMAX_HOLD_POLLS = 2;
const mmState = globalThis as typeof globalThis & {
  __kilnryMinimaxTaskCounter?: number;
  __kilnryMinimaxPolls?: Map<string, number>;
};
mmState.__kilnryMinimaxTaskCounter ??= 2891;
mmState.__kilnryMinimaxPolls ??= new Map<string, number>();
const minimaxPolls = mmState.__kilnryMinimaxPolls;
const orState = globalThis as typeof globalThis & {
  __kilnryOpenRouterVideoPolls?: Map<string, number>;
};
orState.__kilnryOpenRouterVideoPolls ??= new Map<string, number>();
const openRouterVideoPolls = orState.__kilnryOpenRouterVideoPolls;

type TestGlobal = typeof globalThis & {
  __kilnryTestMswStarted?: boolean;
  __kilnryTestMswServer?: ReturnType<typeof setupServer>;
  __kilnryFalSubmitCount?: number;
  __kilnryOpenRouterVideoCount?: number;
};

/**
 * The network-denied switch S-10 uses (F-117). While the flag file exists in the
 * data directory, a request to any host other than this machine rejects exactly
 * as an unreachable network does: a TypeError whose cause carries getaddrinfo
 * ENOTFOUND (https://nodejs.org/api/errors.html#common-system-errors, read
 * 2026-10-07). MSW's own HttpResponse.error() cannot carry that cause — it
 * attaches a Response — and the engine must tell a DNS failure (nothing left the
 * machine, so the job can wait) from a connection lost mid-flight (which may
 * have been received and is never resubmitted automatically).
 */
function denyNetworkWhenFlagged(): void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const dataDir = process.env.KILNRY_DATA_DIR;
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const { hostname } = new URL(url, 'http://127.0.0.1');
    const local = hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]';
    if (!local && dataDir && existsSync(join(dataDir, 'msw-network-down'))) {
      const cause = Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), {
        code: 'ENOTFOUND',
        syscall: 'getaddrinfo',
        hostname,
      });
      throw Object.assign(new TypeError('fetch failed'), { cause });
    }
    return original(input as RequestInfo, init);
  }) as typeof globalThis.fetch;
}

// Status polls seen per fal request id, for the queue progression above.
const falStatusPolls = new Map<string, number>();
// Status polls seen per Replicate training id (F-92).
const replicateTrainingPolls = new Map<string, number>();

export function startTestMsw(): void {
  const global = globalThis as TestGlobal;
  if (global.__kilnryTestMswStarted) return;
  global.__kilnryFalSubmitCount = 0;
  const server = setupServer(
    ...consistencyFixtureHandlers,
    http.get('https://openrouter.ai/api/v1/key', () =>
      HttpResponse.json({ data: { label: 'Kilnry test', limit_remaining: 10 } }),
    ),
    chatCompletionHandler,
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
    // --- OpenRouter video generation (F-03) ---
    // OpenRouter's own documented protocol, copied from its OpenAPI pages
    // (https://openrouter.ai/docs/api/api-reference/video-generation/{submit-a-video-generation-request,
    // poll-video-generation-status,list-all-video-generation-models}.md, read
    // 2026-10-06): POST /videos answers 202 { id, generation_id, polling_url,
    // status: 'pending' }; GET /videos/{jobId} answers { id, generation_id,
    // polling_url, status: pending|in_progress|completed|failed|cancelled|expired,
    // unsigned_urls[], usage: { cost } }; GET /videos/models lists each model with
    // pricing_skus and the durations, resolutions and frame images it supports.
    // Before this the only OpenRouter generation handler was /images, so an edit
    // planned on FLUX Video Edit failed at submit and the run silently swapped to
    // another provider with every shard green.
    http.get('https://openrouter.ai/api/v1/videos/models', () =>
      HttpResponse.json({
        data: [
          {
            id: 'black-forest-labs/flux-video-edit',
            canonical_slug: 'black-forest-labs/flux-video-edit',
            name: 'FLUX Video Edit',
            created: 1_780_000_000,
            description: 'Video-to-video editing model',
            generate_audio: false,
            seed: null,
            allowed_passthrough_parameters: [],
            pricing_skus: { generate: '0.03' },
            supported_aspect_ratios: ['16:9', '9:16'],
            supported_durations: [5, 8],
            supported_frame_images: [],
            supported_resolutions: ['720p', '1080p'],
            supported_sizes: null,
          },
        ],
      }),
    ),
    http.post('https://openrouter.ai/api/v1/videos', async ({ request }) => {
      const body = (await request
        .clone()
        .json()
        .catch(() => ({}))) as Record<string, unknown>;
      const dataDir = process.env.KILNRY_DATA_DIR;
      // What OpenRouter was actually sent, so a check can assert the planned
      // model ran (F-03), the way msw-fal-last-submit.json does for fal.
      if (dataDir) {
        writeFileSync(
          join(dataDir, 'msw-openrouter-last-submit.json'),
          JSON.stringify({ model: body.model ?? null, body }),
        );
      }
      // A check can force this model to fail by dropping a flag file in the data
      // directory (the acceptance spec writes it; the prompts a run sends are
      // written by the planner, so a prompt trigger could not reach the edit
      // step). The refusal is OpenRouter's documented error envelope, { error: {
      // code, message } }, so the alternates path and the D-61 price gate can be
      // driven deterministically (F-03). Nothing else fails here.
      if (dataDir && existsSync(join(dataDir, 'msw-openrouter-video-fail'))) {
        return HttpResponse.json(
          { error: { code: 502, message: 'Upstream provider is unavailable for this model.' } },
          { status: 502 },
        );
      }
      const id = `gen-vid-1789480874-${String(global.__kilnryOpenRouterVideoCount ?? 0).padStart(20, 'A')}`;
      global.__kilnryOpenRouterVideoCount = (global.__kilnryOpenRouterVideoCount ?? 0) + 1;
      return HttpResponse.json(
        { id, generation_id: id, polling_url: `/api/v1/videos/${id}`, status: 'pending' },
        { status: 202 },
      );
    }),
    http.get('https://openrouter.ai/api/v1/videos/:jobId', ({ params }) => {
      const id = String(params.jobId);
      const count = (openRouterVideoPolls.get(id) ?? 0) + 1;
      openRouterVideoPolls.set(id, count);
      // One in_progress poll, then completed with the fixture clip, so the run
      // view and the engine both see a real transition.
      if (count < 2)
        return HttpResponse.json({
          id,
          generation_id: id,
          polling_url: `/api/v1/videos/${id}`,
          status: 'in_progress',
        });
      return HttpResponse.json({
        id,
        generation_id: id,
        polling_url: `/api/v1/videos/${id}`,
        status: 'completed',
        unsigned_urls: [FAL_VIDEO_URL],
        usage: { cost: 0.15 },
      });
    }),
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
            unit_price: 0.084,
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
      global.__kilnryFalSubmitCount = (global.__kilnryFalSubmitCount ?? 0) + 1;
      const dataDir = process.env.KILNRY_DATA_DIR;
      if (dataDir) {
        writeFileSync(join(dataDir, 'msw-fal-submit-count'), String(global.__kilnryFalSubmitCount));
      }
      const body = (await request
        .clone()
        .json()
        .catch(() => ({}))) as { prompt?: string } & Record<string, unknown>;
      // What the provider was actually sent, so an acceptance check can assert
      // that a resolved Character reached fal as an element or an image_url
      // rather than as the literal @handle (S-03, F-CHR-09).
      if (dataDir) {
        const url = new URL(request.url);
        writeFileSync(
          join(dataDir, 'msw-fal-last-submit.json'),
          JSON.stringify({ model: url.pathname.replace(/^\//, ''), body }),
        );
      }
      // fal validates the body against the endpoint's input schema before it
      // queues anything: a missing required field is a 422 whose detail[] names
      // it with loc ["body", "<field>"] (https://docs.fal.ai/model-apis/errors,
      // read 2026-10-06). The required fields are the ones fal's own schema page
      // lists for the endpoint (packages/providers/src/fal/schemas.ts), so a body
      // with the wrong field names fails here exactly as on a real key (F-09,
      // F-10, F-11; D-57: the mock mirrors the provider, not the adapter).
      const submitted = new URL(request.url).pathname.replace(/^\//, '');
      const missing = (falEndpointSchema(submitted)?.required ?? []).filter((field) => {
        const value = body[field];
        return value === undefined || value === null || value === '';
      });
      // A field the endpoint's schema does not have is refused too (D-72). fal's
      // own validator ignores an unknown field, so Kilnry would pay for a video
      // with the Character silently dropped; the mock makes that payload fail
      // where fal would not, which is what the product needs asserted.
      const absent = (falEndpointSchema(submitted)?.absent ?? []).filter(
        (field) => body[field] !== undefined,
      );
      if (absent.length > 0) {
        return HttpResponse.json(
          {
            detail: absent.map((field) => ({
              loc: ['body', field],
              msg: `${submitted} has no ${field} field`,
              type: 'extra_forbidden',
              url: 'https://docs.fal.ai/model-apis/errors',
            })),
          },
          { status: 422, headers: { 'X-Fal-Retryable': 'false' } },
        );
      }
      if (missing.length > 0) {
        return HttpResponse.json(
          {
            detail: missing.map((field) => ({
              loc: ['body', field],
              msg: 'Field required',
              type: 'missing',
              url: 'https://docs.fal.ai/model-apis/errors',
            })),
          },
          { status: 422, headers: { 'X-Fal-Retryable': 'false' } },
        );
      }
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
    // fal's queue status in its documented order (https://docs.fal.ai/model-apis/model-endpoints/queue):
    // `IN_QUEUE` with a `queue_position`, then `IN_PROGRESS` with the `logs`
    // the adapter asks for with `?logs=1`, then `COMPLETED`. It answered
    // COMPLETED at once with no logs, so the queued → running progression and
    // the "Rendering at fal" step label were never exercised (F-93, F-94).
    http.get('https://queue.fal.run/*/requests/*/status', ({ request }) => {
      const requestId = new URL(request.url).pathname.split('/').at(-2) ?? '';
      const seen = (falStatusPolls.get(requestId) ?? 0) + 1;
      falStatusPolls.set(requestId, seen);
      if (seen === 1) return HttpResponse.json({ status: 'IN_QUEUE', queue_position: 1 });
      if (seen === 2) {
        return HttpResponse.json({
          status: 'IN_PROGRESS',
          logs: [{ message: 'Rendering at fal', level: 'INFO', timestamp: new Date().toISOString() }],
        });
      }
      return HttpResponse.json({ status: 'COMPLETED', logs: [] });
    }),
    http.get('https://queue.fal.run/*/requests/*', ({ request }) => {
      const path = new URL(request.url).pathname;
      // A LoRA training request finishes with a safetensors file (F-CHR-07).
      if (/lora-fast-training|flux-lora|training/i.test(path)) {
        return HttpResponse.json({ diffusers_lora_file: { url: FAL_LORA_URL } });
      }
      // Image → 3D answers with fal's published shapes: Trellis `model_mesh`,
      // Hunyuan3D v3 `model_glb` (F-CRE-15).
      if (/hunyuan3d/i.test(path)) {
        return HttpResponse.json({
          model_glb: { url: FAL_GLB_URL, content_type: 'model/gltf-binary', file_name: 'model.glb' },
          model_urls: { glb: { url: FAL_GLB_URL, content_type: 'model/gltf-binary' } },
        });
      }
      if (/trellis/i.test(path)) {
        return HttpResponse.json({
          model_mesh: { url: FAL_GLB_URL, content_type: 'model/gltf-binary', file_name: 'mesh.glb' },
          timings: { prepare: 0.1, generation: 1.2, export: 0.3 },
        });
      }
      const isVideo = /video|kling|veo|seedance|lipsync|sync|latentsync/i.test(path);
      // Voice design and clone finish with { custom_voice_id, audio } — fal's
      // documented output for fal-ai/minimax/voice-{design,clone} (schema
      // MinimaxVoice{Design,Clone}Output). The preview audio lets the UI play it.
      // Kling create-voice finishes with { voice_id } — fal's documented output
      // (schema KlingVideoCreateVoiceOutput, fal.ai/models/fal-ai/kling-video/
      // create-voice/api). Kling's ids are numeric strings.
      if (/kling-video\/create-voice/i.test(path)) {
        return HttpResponse.json({ voice_id: '829877809978941442' });
      }
      if (/voice-design|voice-clone/i.test(path)) {
        return HttpResponse.json({
          custom_voice_id: 'fal_minimax_voice_1',
          audio: { url: FAL_AUDIO_URL, content_type: 'audio/mpeg' },
        });
      }
      // Speech-to-text (scribe) answers with the recognised text and per-word
      // timestamps, which the fal adapter turns into a Kilnry transcript (F-WFL-06).
      if (/speech-to-text|scribe|transcrib/i.test(path)) {
        return HttpResponse.json({
          text: 'Kilnry makes video.',
          chunks: [
            { text: 'Kilnry', timestamp: [0.1, 0.6] },
            { text: 'makes', timestamp: [0.7, 1.1] },
            { text: 'video.', timestamp: [1.2, 1.8] },
          ],
        });
      }
      // A speech or music model answers with one audio file (fal adapter §3.1's
      // output table reads `audio.url`).
      const isAudio = /speech|kokoro|tts|music|sound-effects|ace-step/i.test(path);
      if (isAudio) return HttpResponse.json({ audio: { url: FAL_AUDIO_URL, content_type: 'audio/mpeg' } });
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
    http.get(FAL_GLB_URL, () =>
      HttpResponse.arrayBuffer(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), {
        headers: { 'Content-Type': 'model/gltf-binary' },
      }),
    ),
    http.get(FAL_AUDIO_URL, () =>
      HttpResponse.arrayBuffer(mp3.buffer.slice(mp3.byteOffset, mp3.byteOffset + mp3.byteLength), {
        headers: { 'Content-Type': 'audio/mpeg' },
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
    // --- MiniMax (M5): video with a togglable hang, speech, and voice cloning ---
    // Video submit returns a task id. The status endpoint reports Processing for
    // the first few polls, then Success with a video URL. This lets the
    // ambiguous-timeout scenario (S-11) reach the shrunk poll window, and a later
    // "Check status" find the finished task on the same stored task id — no second
    // submit is ever needed.
    http.post('https://api.minimax.io/v2/video_generation', () => {
      const taskId = String(mmState.__kilnryMinimaxTaskCounter!++);
      return HttpResponse.json({ task_id: taskId, base_resp: { status_code: 0, status_msg: 'success' } });
    }),
    // MiniMax's own documented query route and envelope: GET
    // /v2/query/video_generation/{task_id} answering { task: { id, model,
    // status, content: { url }, … } }
    // (https://platform.minimax.io/docs/api-reference/video-generation-v2-query,
    // read 2026-10-06). Nothing answers the undocumented path the adapter used
    // to build, so F-107 cannot pass here either (D-57).
    http.get('https://api.minimax.io/v2/query/video_generation/:taskId', ({ params }) => {
      const taskId = String(params.taskId);
      const count = (minimaxPolls.get(taskId) ?? 0) + 1;
      minimaxPolls.set(taskId, count);
      // The first two polls of a task report processing so the first job's short
      // poll loop reaches its timeout; the third poll onward (a Check status on
      // the same task id) reports the finished video. This is deterministic and
      // drives the ambiguous-timeout scenario (S-11) without wall-clock timing.
      if (count <= MINIMAX_HOLD_POLLS) {
        return HttpResponse.json({ task: { id: taskId, model: 'MiniMax-H3', status: 'running' } });
      }
      return HttpResponse.json({
        task: {
          id: taskId,
          model: 'MiniMax-H3',
          status: 'succeeded',
          content: { url: FAL_VIDEO_URL },
          resolution: '768P',
          duration: 6,
        },
      });
    }),
    http.get('https://api.minimax.io/v1/query/video_generation', () =>
      HttpResponse.json({ base_resp: { status_code: 0 } }),
    ),
    // Text to speech returns the audio as a hex string in the body.
    http.post('https://api.minimax.io/v1/t2a_v2', async ({ request }) => {
      const body = (await request
        .clone()
        .json()
        .catch(() => ({}))) as { text?: string };
      return HttpResponse.json({
        data: { audio: mp3.toString('hex') },
        extra_info: { usage_characters: (body.text ?? '').length },
        base_resp: { status_code: 0, status_msg: 'success' },
      });
    }),
    // Voice cloning: upload the sample, then create the clone.
    http.post('https://api.minimax.io/v1/files/upload', () =>
      HttpResponse.json({ file: { file_id: 'file_fixture_1' }, base_resp: { status_code: 0 } }),
    ),
    http.post('https://api.minimax.io/v1/voice_clone', () =>
      HttpResponse.json({ base_resp: { status_code: 0, status_msg: 'success' } }),
    ),
    http.post('https://api.minimax.io/v1/voice_design', () =>
      HttpResponse.json({
        voice_id: 'ttv-voice-fixture-1',
        trial_audio: 'ab',
        base_resp: { status_code: 0, status_msg: 'success' },
      }),
    ),
    // --- ElevenLabs (M5): key test, voice add, and text to speech ---
    http.get('https://api.elevenlabs.io/v1/user/subscription', () =>
      HttpResponse.json({ tier: 'starter', character_limit: 100_000, character_count: 0 }),
    ),
    http.post('https://api.elevenlabs.io/v1/voices/add', () =>
      HttpResponse.json({ voice_id: 'el_fixture_voice_1' }),
    ),
    http.post('https://api.elevenlabs.io/v1/text-to-speech/:voiceId', () =>
      HttpResponse.arrayBuffer(mp3.buffer.slice(mp3.byteOffset, mp3.byteOffset + mp3.byteLength), {
        headers: { 'Content-Type': 'audio/mpeg' },
      }),
    ),
    // Dubbing and voice change return the converted audio inline (F-CRE-11).
    http.post('https://api.elevenlabs.io/v1/dubbing', () =>
      HttpResponse.arrayBuffer(mp3.buffer.slice(mp3.byteOffset, mp3.byteOffset + mp3.byteLength), {
        headers: { 'Content-Type': 'audio/mpeg' },
      }),
    ),
    http.post('https://api.elevenlabs.io/v1/speech-to-speech/:voiceId', () =>
      HttpResponse.arrayBuffer(mp3.buffer.slice(mp3.byteOffset, mp3.byteOffset + mp3.byteLength), {
        headers: { 'Content-Type': 'audio/mpeg' },
      }),
    ),
    // fal's own storage for media inputs (TRD-06 §3.1): initiate, then the PUT.
    http.post('https://rest.alpha.fal.ai/storage/upload/initiate', () =>
      HttpResponse.json({
        upload_url: 'https://storage.fal.test/upload/kilnry-input',
        file_url: 'https://v3.fal.media/files/test/kilnry-input',
      }),
    ),
    http.put('https://storage.fal.test/upload/kilnry-input', () => new HttpResponse(null, { status: 200 })),
    // Ollama detection (F-PRV-08) probes the loopback runtime on every Providers
    // and Chat visit. No Ollama runs in the harness, so the probe is refused the
    // way an absent local server refuses it (the adapter reports not detected).
    http.get('http://127.0.0.1:11434/api/tags', () => HttpResponse.error()),
    http.get('http://localhost:11434/api/tags', () => HttpResponse.error()),
    // --- Higgsfield (M5): free estimate, and Soul ID custom references ---
    http.post('https://api.higgsfield.ai/estimate/*', () =>
      HttpResponse.json({ credits: '1.500', usd: '0.094' }),
    ),
    http.post('https://api.higgsfield.ai/v1/custom-references', () =>
      HttpResponse.json({ id: 'cr_fixture_1', status: 'queued' }),
    ),
    http.get('https://api.higgsfield.ai/v1/custom-references/:id', () =>
      HttpResponse.json({ id: 'cr_fixture_1', status: 'completed' }),
    ),
    // The Higgsfield generation request id status (Soul 2 in Create, S-23).
    http.post('https://api.higgsfield.ai/*', () =>
      HttpResponse.json({
        request_id: 'hf_req_1',
        status_url: 'https://api.higgsfield.ai/requests/hf_req_1/status',
      }),
    ),
    // The documented completed payload: `images[{url}]` for an image model,
    // `video{url}` or `audio{url}` otherwise, with the provider's own figure
    // (https://docs.higgsfield.ai/docs/concepts/requests.md; the reference doc's
    // Higgsfield row). It returned `results[]`, which the adapter never reads (F-99).
    http.get('https://api.higgsfield.ai/requests/:id/status', () =>
      HttpResponse.json({
        status: 'completed',
        images: [{ url: FAL_VIDEO_URL.replace('.mp4', '.png') }],
        usd: '0.094',
      }),
    ),
    // --- OpenAI, Replicate and Google (F-92): PRD-14 §11 criterion 1 asks every
    // §1 provider to connect with its documented test call in the MSW-mocked
    // suite; these three had no handler, so any call reached print.error().
    // OpenAI: `GET /v1/models` list and `POST /v1/images/generations` with
    // inline `b64_json` (https://developers.openai.com/api/docs, reference doc
    // §OpenAI rows "Base" and "Images"); TRD-19's moderation row is the 400
    // `moderation_blocked` envelope.
    http.get('https://api.openai.com/v1/models', () =>
      HttpResponse.json({
        object: 'list',
        data: [{ id: 'gpt-image-2', object: 'model', created: 1767225600, owned_by: 'openai' }],
      }),
    ),
    http.post('https://api.openai.com/v1/images/generations', async ({ request }) => {
      const body = (await request.json().catch(() => ({}))) as { prompt?: string; n?: number };
      if (typeof body.prompt === 'string' && body.prompt.includes('TRIGGER')) {
        return HttpResponse.json(
          {
            error: {
              message: 'Your request was rejected as a result of our safety system.',
              type: 'user_error',
              param: null,
              code: 'moderation_blocked',
            },
          },
          { status: 400 },
        );
      }
      return HttpResponse.json({
        created: Math.floor(Date.now() / 1000),
        data: Array.from({ length: body.n ?? 1 }, () => ({ b64_json: png.toString('base64') })),
        usage: { input_tokens: 20, output_tokens: 1056, total_tokens: 1076 },
      });
    }),
    // Replicate: `GET /v1/account` as the test call, and a training created on a
    // model version, polled at `urls.get` through `starting → processing →
    // succeeded` with `output.{version,weights}`
    // (https://replicate.com/docs/reference/http — account.get, trainings.create,
    // trainings.get).
    http.get('https://api.replicate.com/v1/account', () =>
      HttpResponse.json({ type: 'user', username: 'kilnry-test', name: 'Kilnry test', github_url: null }),
    ),
    http.post(
      'https://api.replicate.com/v1/models/:owner/:name/versions/:version/trainings',
      ({ params }) => {
        const id = `rt_${crypto.randomUUID().slice(0, 8)}`;
        return HttpResponse.json(
          {
            id,
            model: `${String(params.owner)}/${String(params.name)}`,
            version: String(params.version),
            status: 'starting',
            created_at: new Date().toISOString(),
            urls: {
              get: `https://api.replicate.com/v1/trainings/${id}`,
              cancel: `https://api.replicate.com/v1/trainings/${id}/cancel`,
            },
          },
          { status: 201 },
        );
      },
    ),
    http.get('https://api.replicate.com/v1/trainings/:id', ({ params }) => {
      const id = String(params.id);
      const seen = (replicateTrainingPolls.get(id) ?? 0) + 1;
      replicateTrainingPolls.set(id, seen);
      if (seen === 1)
        return HttpResponse.json({ id, status: 'processing', logs: 'flux_train_replicate: step 1/1000' });
      return HttpResponse.json({
        id,
        status: 'succeeded',
        output: { version: 'kilnry-test/maya-kilnry:fixture1', weights: FAL_LORA_URL },
        metrics: { predict_time: 412.7 },
      });
    }),
    // Google: `GET /models?pageSize=1` as the test call; Gemini image through
    // `:generateContent` with `inlineData` parts
    // (https://ai.google.dev/gemini-api/docs/image-generation); Veo through
    // `:predictLongRunning` → operation `name`, polled until `done` with
    // `generateVideoResponse.generatedSamples[0].video.uri`, downloaded with
    // the key (https://ai.google.dev/gemini-api/docs/veo). TRD-19's moderation
    // row is `promptFeedback.blockReason`.
    http.get('https://generativelanguage.googleapis.com/v1beta/models', () =>
      HttpResponse.json({
        models: [{ name: 'models/gemini-3.1-flash-image', displayName: 'Nano Banana 2' }],
        nextPageToken: 'fixture-next',
      }),
    ),
    http.post(
      'https://generativelanguage.googleapis.com/v1beta/models/:call',
      async ({ params, request }) => {
        const call = String(params.call);
        const model = call.split(':')[0] ?? '';
        if (call.endsWith(':predictLongRunning')) {
          return HttpResponse.json({
            name: `models/${model}/operations/${crypto.randomUUID().slice(0, 12)}`,
          });
        }
        const body = (await request.json().catch(() => ({}))) as {
          contents?: Array<{ parts?: Array<{ text?: string }> }>;
        };
        const text =
          body.contents
            ?.flatMap((entry) => entry.parts ?? [])
            .map((part) => part.text ?? '')
            .join(' ') ?? '';
        if (text.includes('TRIGGER')) return HttpResponse.json({ promptFeedback: { blockReason: 'SAFETY' } });
        return HttpResponse.json({
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ inlineData: { mimeType: 'image/png', data: png.toString('base64') } }],
              },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: { promptTokenCount: 18, candidatesTokenCount: 1290, totalTokenCount: 1308 },
          modelVersion: model,
        });
      },
    ),
    http.get('https://generativelanguage.googleapis.com/v1beta/models/:model/operations/:op', ({ params }) =>
      HttpResponse.json({
        name: `models/${String(params.model)}/operations/${String(params.op)}`,
        done: true,
        response: {
          generateVideoResponse: {
            generatedSamples: [{ video: { uri: GOOGLE_VIDEO_URL } }],
            raiMediaFilteredCount: 0,
          },
        },
      }),
    ),
    http.get(GOOGLE_VIDEO_URL, () =>
      HttpResponse.arrayBuffer(mp4.buffer.slice(mp4.byteOffset, mp4.byteOffset + mp4.byteLength), {
        headers: { 'Content-Type': 'video/mp4' },
      }),
    ),
    // The safetensors bytes a completed fal LoRA training points at (F-CHR-07).
    http.get(FAL_LORA_URL, () =>
      HttpResponse.arrayBuffer(safetensors.buffer.slice(0, safetensors.byteLength), {
        headers: { 'Content-Type': 'application/octet-stream' },
      }),
    ),
  );
  server.listen({
    onUnhandledRequest: (request, print) => {
      // The release-manifest fixture (F-SET-07) and the app's own loopback are
      // real local servers, not mocks; let them through. Any other unhandled
      // outbound request is a test gap and must error.
      const url = new URL(request.url);
      if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return;
      print.error();
    },
  });
  // After listen(), so this wraps MSW's own patched fetch rather than being
  // replaced by it.
  denyNetworkWhenFlagged();
  global.__kilnryTestMswServer = server;
  global.__kilnryTestMswStarted = true;
}

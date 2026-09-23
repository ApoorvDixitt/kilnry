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
import { chatCompletionHandler } from './chat-openrouter-fixture';

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

type TestGlobal = typeof globalThis & {
  __kilnryTestMswStarted?: boolean;
  __kilnryTestMswServer?: ReturnType<typeof setupServer>;
  __kilnryFalSubmitCount?: number;
};

export function startTestMsw(): void {
  const global = globalThis as TestGlobal;
  if (global.__kilnryTestMswStarted) return;
  global.__kilnryFalSubmitCount = 0;
  const server = setupServer(
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
            unit_price: 0.084,
            unit: 'second',
            currency: 'USD',
          },
        ],
      }),
    ),
    // fal create-voice (Kling) is synchronous and returns a voice id (F-VOI-02).
    http.post('https://queue.fal.run/fal-ai/kling-video/create-voice', () =>
      HttpResponse.json({ voice_id: 'fal_kling_voice_1' }),
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
      const path = new URL(request.url).pathname;
      // A LoRA training request finishes with a safetensors file (F-CHR-07).
      if (/lora-fast-training|flux-lora|training/i.test(path)) {
        return HttpResponse.json({ diffusers_lora_file: { url: FAL_LORA_URL } });
      }
      const isVideo = /video|kling|veo|seedance|lipsync|sync|latentsync/i.test(path);
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
    // Video submit returns a task id. The status endpoint reports Processing until
    // KILNRY_TEST_TIMEOUT_S seconds have elapsed since the task was first seen,
    // then Success with a video URL. This lets the ambiguous-timeout scenario
    // (S-11) reach the poll timeout, and a later "Check status" find the finished
    // task on the same stored task id — no second submit is ever needed.
    http.post('https://api.minimax.io/v2/video_generation', () => {
      const taskId = String(mmState.__kilnryMinimaxTaskCounter!++);
      return HttpResponse.json({ task_id: taskId, base_resp: { status_code: 0, status_msg: 'success' } });
    }),
    http.get('https://api.minimax.io/v2/video_generation/:taskId', ({ params }) => {
      const taskId = String(params.taskId);
      const count = (minimaxPolls.get(taskId) ?? 0) + 1;
      minimaxPolls.set(taskId, count);
      // The first two polls of a task report processing so the first job's short
      // poll loop reaches its timeout; the third poll onward (a Check status on
      // the same task id) reports the finished video. This is deterministic and
      // drives the ambiguous-timeout scenario (S-11) without wall-clock timing.
      if (count <= MINIMAX_HOLD_POLLS) {
        return HttpResponse.json({ status: 'processing', base_resp: { status_code: 0 } });
      }
      return HttpResponse.json({
        status: 'succeeded',
        video_url: FAL_VIDEO_URL,
        base_resp: { status_code: 0 },
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
    http.get('https://api.higgsfield.ai/requests/:id/status', () =>
      HttpResponse.json({ status: 'completed', results: [{ url: FAL_VIDEO_URL.replace('.mp4', '.png') }] }),
    ),
    // The safetensors bytes a completed fal LoRA training points at (F-CHR-07).
    http.get(FAL_LORA_URL, () =>
      HttpResponse.arrayBuffer(safetensors.buffer.slice(0, safetensors.byteLength), {
        headers: { 'Content-Type': 'application/octet-stream' },
      }),
    ),
  );
  server.listen({ onUnhandledRequest: 'error' });
  global.__kilnryTestMswServer = server;
  global.__kilnryTestMswStarted = true;
}

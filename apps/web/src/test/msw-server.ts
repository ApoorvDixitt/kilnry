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
  'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAARkbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAA490cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAEAAABAAAAAAMHbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAyAAAAMgBVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAACsm1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAnJzdGJsAAAAvnN0c2QAAAAAAAAAAQAAAK5hdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABFUxhdmM2Mi4xMS4xMDAgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAANGF2Y0MBZAAK/+EAF2dkAAqs2V7ARAAAAwAEAAADAMg8SJZYAQAGaOvjyyLA/fj4AAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAACBoAAAAAAAAABhzdHRzAAAAAAAAAAEAAAAZAAACAAAAABRzdHNzAAAAAAAAAAEAAAABAAAA2GN0dHMAAAAAAAAAGQAAAAEAAAQAAAAAAQAACgAAAAABAAAEAAAAAAEAAAAAAAAAAQAAAgAAAAABAAAKAAAAAAEAAAQAAAAAAQAAAAAAAAABAAACAAAAAAEAAAoAAAAAAQAABAAAAAABAAAAAAAAAAEAAAIAAAAAAQAACgAAAAABAAAEAAAAAAEAAAAAAAAAAQAAAgAAAAABAAAKAAAAAAEAAAQAAAAAAQAAAAAAAAABAAACAAAAAAEAAAoAAAAAAQAABAAAAAABAAAAAAAAAAEAAAIAAAAAHHN0c2MAAAAAAAAAAQAAAAEAAAAZAAAAAQAAAHhzdHN6AAAAAAAAAAAAAAAZAAACxQAAAAwAAAAMAAAADAAAAAwAAAASAAAADgAAAAwAAAAMAAAAEgAAAA4AAAAMAAAADAAAABIAAAAOAAAADAAAAAwAAAASAAAADgAAAAwAAAAMAAAAEgAAAA4AAAAMAAAADAAAABRzdGNvAAAAAAAAAAEAAASUAAAAYXVkdGEAAABZbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAsaWxzdAAAACSpdG9vAAAAHGRhdGEAAAABAAAAAExhdmY2Mi4zLjEwMAAAAAhmcmVlAAAEFW1kYXQAAAKuBgX//6rcRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTY1IHIzMjIyIGIzNTYwNWEgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDI1IC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MSByZWY9MyBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgzOjB4MTEzIG1lPWhleCBzdWJtZT03IHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0xIDh4OGRjdD0xIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS0yIHRocmVhZHM9MSBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTMgYl9weXJhbWlkPTIgYl9hZGFwdD0xIGJfYmlhcz0wIGRpcmVjdD0xIHdlaWdodGI9MSBvcGVuX2dvcD0wIHdlaWdodHA9MiBrZXlpbnQ9MjUwIGtleWludF9taW49MjUgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAAPZYiEADv//vdOvwKbVMJhAAAACEGaJGxDv/7gAAAACEGeQniF/8GBAAAACAGeYXRCv8SAAAAACAGeY2pCv8SBAAAADkGaaEmoQWiZTAh3//7hAAAACkGehkURLC//wYEAAAAIAZ6ldEK/xIEAAAAIAZ6nakK/xIAAAAAOQZqsSahBbJlMCHf//uAAAAAKQZ7KRRUsL//BgQAAAAgBnul0Qr/EgAAAAAgBnutqQr/EgAAAAA5BmvBJqEFsmUwIb//+4QAAAApBnw5FFSwv/8GBAAAACAGfLXRCv8SBAAAACAGfL2pCv8SAAAAADkGbNEmoQWyZTAhn//7gAAAACkGfUkUVLC//wYEAAAAIAZ9xdEK/xIAAAAAIAZ9zakK/xIAAAAAOQZt4SahBbJlMCFf//sEAAAAKQZ+WRRUsL//BgAAAAAgBn7V0Qr/EgQAAAAgBn7dqQr/EgQ==',
  'base64',
);
// A single HTTPS location the fal video fixture points at; the engine downloads
// the bytes from here after the queue job completes.
const FAL_VIDEO_URL = 'https://v3.fal.media/files/test/kilnry-fixture.mp4';
// Where a completed fal LoRA training points at its safetensors file (F-CHR-07).
const FAL_LORA_URL = 'https://v3.fal.media/files/test/kilnry-lora.safetensors';

// A tiny valid MP3 frame the speech and voice fixtures return as bytes.
const mp3 = Buffer.from(
  'SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjYyLjMuMTAwAAAAAAAAAAAAAAD/+xDEAAPAAAGkAAAAIAAANIAAAAT/',
  'base64',
);
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
};

// The S-24 chat scenario needs a scripted large language model (LLM). The
// OpenRouter chat-completions fixture below inspects the conversation to decide
// which tool the agent should call next: it discovers a skill, loads it, prices
// the plan, then asks for one kilnry_generate of three video variants without a
// confirmed cost so an ApprovalCard is raised; once that generate has run it
// answers with plain text so the turn ends.
interface OpenAiMessage {
  role: string;
  content?: unknown;
  tool_calls?: Array<{ function?: { name?: string } }>;
}

// How many assistant tool-call rounds are already in the conversation.
function priorToolRounds(messages: OpenAiMessage[]): { generateAsked: boolean; toolResults: number } {
  let generateAsked = false;
  let toolResults = 0;
  for (const message of messages) {
    if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
      if (message.tool_calls.some((call) => call.function?.name === 'kilnry_generate')) {
        generateAsked = true;
      }
    }
    if (message.role === 'tool') toolResults += 1;
  }
  return { generateAsked, toolResults };
}

// One OpenAI-style streaming tool call: an id/name chunk, the arguments, then a
// finish_reason of tool_calls, ending with [DONE]. The AI SDK's OpenAI-compatible
// parser reads these into a single tool call.
function toolCallStream(id: string, name: string, args: Record<string, unknown>): string {
  const model = 'anthropic/claude-sonnet-5';
  const base = { id: `chatcmpl-${id}`, object: 'chat.completion.chunk', created: 0, model };
  const chunks = [
    { ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] },
    {
      ...base,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: `call_${id}`,
                type: 'function',
                function: { name, arguments: JSON.stringify(args) },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    },
    { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
  ];
  return `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}`).join('\n\n')}\n\ndata: [DONE]\n\n`;
}

function textStream(text: string): string {
  const model = 'anthropic/claude-sonnet-5';
  const base = { id: 'chatcmpl-final', object: 'chat.completion.chunk', created: 0, model };
  const chunks = [
    { ...base, choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] },
    {
      ...base,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 200, completion_tokens: 40, total_tokens: 240 },
    },
  ];
  return `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}`).join('\n\n')}\n\ndata: [DONE]\n\n`;
}

function sse(body: string): Response {
  return new HttpResponse(body, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
  });
}

export function startTestMsw(): void {
  const global = globalThis as TestGlobal;
  if (global.__kilnryTestMswStarted) return;
  const server = setupServer(
    http.get('https://openrouter.ai/api/v1/key', () =>
      HttpResponse.json({ data: { label: 'Kilnry test', limit_remaining: 10 } }),
    ),
    // The scripted chat LLM for S-24. It walks the agent through discovering a
    // skill, loading it, pricing the plan, then a single kilnry_generate of three
    // video variants with no confirmed cost (so an ApprovalCard is raised); once
    // that generate has run it answers with plain text so the turn ends.
    http.post('https://openrouter.ai/api/v1/chat/completions', async ({ request }) => {
      const body = (await request
        .clone()
        .json()
        .catch(() => ({}))) as { messages?: OpenAiMessage[] };
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const state = priorToolRounds(messages);
      if (state.generateAsked) {
        return sse(textStream('Here are your three chai reel variants.'));
      }
      if (state.toolResults === 0) {
        return sse(toolCallStream('skills-list', 'kilnry_skills', { action: 'list' }));
      }
      if (state.toolResults === 1) {
        return sse(
          toolCallStream('skills-load', 'kilnry_skills', { action: 'load', name: 'ugc-hook-talking-head' }),
        );
      }
      if (state.toolResults === 2) {
        return sse(
          toolCallStream('estimate', 'kilnry_estimate', {
            requests: [
              { kind: 'video', prompt: 'chai reel variant 1' },
              { kind: 'video', prompt: 'chai reel variant 2' },
              { kind: 'video', prompt: 'chai reel variant 3' },
            ],
          }),
        );
      }
      return sse(
        toolCallStream('generate', 'kilnry_generate', {
          requests: [
            { kind: 'video', prompt: 'chai reel variant 1' },
            { kind: 'video', prompt: 'chai reel variant 2' },
            { kind: 'video', prompt: 'chai reel variant 3' },
          ],
        }),
      );
    }),
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

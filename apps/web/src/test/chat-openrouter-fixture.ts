// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The scripted OpenRouter conversation used by the route and browser acceptance
// tests for S-24. Its tool-call chunks deliberately match the provider's own
// doStream test: the first chunk has content:null and the call id, function name
// and empty arguments; a following chunk carries the argument delta; then the
// tool_calls finish chunk, an empty choices usage chunk, and [DONE].

import { http, HttpResponse, type HttpHandler } from 'msw';

interface OpenAiToolCall {
  function?: { name?: string };
}

interface OpenAiMessage {
  role: string;
  content?: unknown;
  tool_calls?: OpenAiToolCall[];
}

export const CHAI_VIDEO_MODEL = 'fal-ai/kling-video/v3/standard/text-to-video';
export const CHAI_VIDEO_PROMPTS = [
  'chai reel variant 1',
  'chai reel variant 2',
  'chai reel variant 3',
] as const;

function userText(message: OpenAiMessage | undefined): string {
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  if (!Array.isArray(message.content)) return '';
  return message.content
    .flatMap((part) =>
      part && typeof part === 'object' && (part as { type?: unknown }).type === 'text'
        ? [String((part as { text?: unknown }).text ?? '')]
        : [],
    )
    .join(' ');
}

function currentTurn(messages: OpenAiMessage[]): { prompt: string; messages: OpenAiMessage[] } {
  let lastUser = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      lastUser = index;
      break;
    }
  }
  return {
    prompt: userText(lastUser >= 0 ? messages[lastUser] : undefined),
    messages: lastUser >= 0 ? messages.slice(lastUser + 1) : messages,
  };
}

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

function event(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/** One streamed function call in the exact shape parsed by the pinned provider. */
export function toolCallStream(id: string, name: string, input: Record<string, unknown>): string {
  const model = 'anthropic/claude-sonnet-5';
  const base = {
    id: `chatcmpl-${id}`,
    object: 'chat.completion.chunk',
    created: 1_711_357_598,
    model,
    system_fingerprint: 'kilnry-fixture',
  };
  return [
    event({
      ...base,
      choices: [
        {
          index: 0,
          delta: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                index: 0,
                id: `call_${id}`,
                type: 'function',
                function: { name, arguments: '' },
              },
            ],
          },
          logprobs: null,
          finish_reason: null,
        },
      ],
    }),
    event({
      ...base,
      choices: [
        {
          index: 0,
          delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(input) } }] },
          logprobs: null,
          finish_reason: null,
        },
      ],
    }),
    event({
      ...base,
      choices: [{ index: 0, delta: {}, logprobs: null, finish_reason: 'tool_calls' }],
    }),
    event({
      ...base,
      choices: [],
      usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
    }),
    'data: [DONE]\n\n',
  ].join('');
}

function textStream(text: string): string {
  const model = 'anthropic/claude-sonnet-5';
  const base = {
    id: 'chatcmpl-final',
    object: 'chat.completion.chunk',
    created: 1_711_357_598,
    model,
  };
  return [
    event({
      ...base,
      choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }],
    }),
    event({
      ...base,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    }),
    event({
      ...base,
      choices: [],
      usage: { prompt_tokens: 200, completion_tokens: 40, total_tokens: 240 },
    }),
    'data: [DONE]\n\n',
  ].join('');
}

function sse(body: string): Response {
  return new HttpResponse(body, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
  });
}

// A plain (non-streamed) chat completion, the shape kilnry_analyze and the
// appearance descriptor read (completion.choices[0].message.content).
function completion(content: string): Response {
  return HttpResponse.json({
    id: 'chatcmpl-analyze',
    object: 'chat.completion',
    model: 'google/gemini-3.1-flash-lite',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 200, completion_tokens: 60, total_tokens: 260 },
  });
}

// Pull an explicit count out of an analyze prompt ("Exactly 4 blocks", "Write 3
// scenes", "into 5 blocks"), so the fixture returns arrays the workflow's
// foreach expects (rule 7.4 checks the count). Defaults to three.
function requestedCount(prompt: string): number {
  const match =
    /(?:exactly|write|into|split[^.]*into)\s+(\d+)\s+(?:blocks?|scenes?|segments?|framings?)/i.exec(prompt) ??
    /(\d+)\s+(?:blocks?|scenes?|segments?|framings?)/i.exec(prompt);
  const n = match ? Number(match[1]) : 3;
  return Number.isFinite(n) && n > 0 && n <= 24 ? n : 3;
}

// One covering JSON object with every key any shipped workflow's analyze schema
// requires, sized to the prompt. A workflow reads only the keys its own schema
// names, so a superset satisfies each schema while one fixture serves all nine.
function analyzeJson(prompt: string): string {
  const n = requestedCount(prompt);
  const lines = Array.from({ length: n }, (_, i) => `Scripted line ${i + 1}.`);
  const blocks = Array.from({ length: n }, (_, i) => ({
    line: `Scripted line ${i + 1}.`,
    on_screen: `Beat ${i + 1}`,
  }));
  const scenes = Array.from({ length: n }, (_, i) => ({ beat: `Scene ${i + 1}`, motion: 'gentle push-in' }));
  return JSON.stringify({
    // qa_check / gate
    ok: true,
    pass: true,
    reasons: [],
    issues: [],
    // product normalisation / photoshoot
    description: 'A clear product on a plain background.',
    visible_text: '',
    tier: 'everyday',
    // ugc script
    segments: lines,
    hook: 'Watch this.',
    // thumbnail
    framings: Array.from({ length: n }, (_, i) => `framing ${i + 1}`),
    // character sheet
    descriptor: 'A calm subject in soft daylight.',
    anchors: ['soft daylight', 'neutral background'],
    negative_traits: ['no text', 'no watermark'],
    palette_hex: ['#e8e2d9', '#3b3a36'],
    gendered_noun: 'person',
    // faceless video
    title: 'Scripted narration',
    blocks,
    roster: ['narrator'],
    sources: [],
    // motion design
    scenes,
  });
}

function isStreaming(body: { stream?: unknown; tools?: unknown }): boolean {
  return body.stream === true || Array.isArray(body.tools);
}

function videoRequests(): Array<Record<string, unknown>> {
  return CHAI_VIDEO_PROMPTS.map((prompt) => ({
    kind: 'video',
    prompt,
    model: CHAI_VIDEO_MODEL,
    params: { duration_s: 5, resolution: '720p', audio: false },
  }));
}

/** The one handler shared by the route-level Vitest and the Playwright server. */
export const chatCompletionHandler: HttpHandler = http.post(
  'https://openrouter.ai/api/v1/chat/completions',
  async ({ request }) => {
    const body = (await request
      .clone()
      .json()
      .catch(() => ({}))) as { messages?: OpenAiMessage[]; stream?: unknown; tools?: unknown };
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const turn = currentTurn(messages);
    const state = priorToolRounds(turn.messages);

    // A non-streamed completion is a kilnry_analyze task or the appearance
    // descriptor (both ask for a plain JavaScript Object Notation reply, no
    // tools, no stream). Answer with a schema-shaped object sized to the prompt.
    if (!isStreaming(body)) {
      return completion(analyzeJson(turn.prompt));
    }

    // The single-image branch is deliberately below the session threshold, so
    // it runs without an approval card and lands in the Library.
    if (/one chai poster/i.test(turn.prompt)) {
      if (state.generateAsked) return sse(textStream('The chai poster is in your Library.'));
      return sse(
        toolCallStream('single-image', 'kilnry_generate', {
          requests: [
            {
              kind: 'image',
              prompt: 'a steaming cutting chai poster',
              model: 'fal-ai/flux-2/klein/4b',
              params: { width: 1024, height: 1024, quality: 'draft' },
            },
          ],
        }),
      );
    }

    // The second request goes straight to the same three-video plan so the
    // session cap, not another discovery round, is what pauses it.
    if (/do it again/i.test(turn.prompt)) {
      if (state.generateAsked) return sse(textStream('The repeated plan is ready.'));
      return sse(toolCallStream('generate-again', 'kilnry_generate', { requests: videoRequests() }));
    }

    if (state.generateAsked) return sse(textStream('Here are your three chai reel variants.'));
    if (state.toolResults === 0) {
      return sse(toolCallStream('skills-list', 'kilnry_skills', { action: 'list' }));
    }
    if (state.toolResults === 1) {
      return sse(
        toolCallStream('skills-load', 'kilnry_skills', {
          action: 'load',
          name: 'ugc-hook-talking-head',
        }),
      );
    }
    if (state.toolResults === 2) {
      return sse(
        toolCallStream('estimate', 'kilnry_estimate', {
          kind: 'video',
          prompt: 'three chai reel variants',
          model: CHAI_VIDEO_MODEL,
          params: { duration_s: 5, resolution: '720p', audio: false },
          count: 3,
        }),
      );
    }
    return sse(toolCallStream('generate', 'kilnry_generate', { requests: videoRequests() }));
  },
);

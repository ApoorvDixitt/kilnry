// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Look at media with a vision-language model for kilnry_analyze (F-MCP-02). It
// reuses the same OpenRouter chat route and the cheapest vision model the
// appearance descriptor uses, but returns plain text for the describe and
// caption tasks rather than the descriptor's structured shape.

import { KilnryError } from '../errors.js';
import { DESCRIPTOR_MODEL } from './descriptor.js';

// The analyze tasks this helper serves today. Other tasks are not available yet.
export const ANALYZE_TASKS = ['describe', 'caption'] as const;
export type AnalyzeTask = (typeof ANALYZE_TASKS)[number];

export function isSupportedAnalyzeTask(task: string): task is AnalyzeTask {
  return (ANALYZE_TASKS as readonly string[]).includes(task);
}

// The cheapest vision-language model, chosen when the caller asks for 'auto'.
export const CHEAPEST_VLM = DESCRIPTOR_MODEL;

const TASK_PROMPT: Record<AnalyzeTask, string> = {
  describe:
    'Describe what is in the image or images plainly and specifically in two or three sentences. No preamble.',
  caption: 'Write one short caption for the image, under 20 words. No quotation marks, no preamble.',
};

interface ChatCompletion {
  choices?: Array<{ message?: { content?: string } }>;
}

export interface AnalyzeOptions {
  task: AnalyzeTask;
  imageUrls: string[];
  apiKey: string;
  instructions?: string;
  model?: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

// Run a describe or caption over the given image URLs and return the model's
// text and the model used. Never throws for a normal provider failure without a
// clear message; callers wrap it into a structured tool error.
export async function analyzeMedia(options: AnalyzeOptions): Promise<{ text: string; model: string }> {
  if (options.imageUrls.length === 0) {
    throw new KilnryError('INVALID_INPUT', 'At least one image is needed to analyze.');
  }
  const model = options.model && options.model !== 'auto' ? options.model : CHEAPEST_VLM;
  const prompt = `${TASK_PROMPT[options.task]}${options.instructions ? ` ${options.instructions}` : ''}`;
  const requestFetch = options.fetch ?? fetch;
  const body = {
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          ...options.imageUrls.map((url) => ({ type: 'image_url', image_url: { url } })),
        ],
      },
    ],
  };
  let response: Response;
  try {
    response = await requestFetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://kilnry.app',
        'X-Title': 'Kilnry',
      },
      body: JSON.stringify(body),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    throw new KilnryError('PROVIDER_ERROR', 'Could not reach the analysis model.', {
      retryable: true,
      provider: 'openrouter',
      cause: error,
    });
  }
  if (!response.ok) {
    throw new KilnryError('PROVIDER_ERROR', `The analysis model failed (${response.status}).`, {
      retryable: response.status >= 500 || response.status === 429,
      provider: 'openrouter',
    });
  }
  const completion = (await response.json()) as ChatCompletion;
  const text = completion.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new KilnryError('PROVIDER_ERROR', 'The analysis model returned no content.', { retryable: true });
  }
  return { text, model };
}

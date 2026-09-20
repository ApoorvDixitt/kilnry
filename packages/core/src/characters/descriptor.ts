// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as z from 'zod';
import { KilnryError } from '../errors.js';

// Load the vision-language model prompt from the markdown file the workflow
// specification (TRD-12 §9) loads with file(). Decision D-47a allows this product
// prompt asset under packages/**. The leading HTML licence comment is stripped so
// only the prompt text reaches the model. The exported name is unchanged so every
// caller keeps working.
function loadDescriptorPrompt(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(join(here, 'descriptor.prompt.md'), 'utf8');
  return raw.replace(/^<!--[\s\S]*?-->\s*/, '').trim();
}

export const DESCRIPTOR_PROMPT = loadDescriptorPrompt();

// The cheapest vision-language model, per TRD-14 §8.
export const DESCRIPTOR_MODEL = 'google/gemini-3.1-flash-lite';

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function wordCount(value: string): number {
  const trimmed = value.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

// The structured appearance the model must return (TRD-14 §8).
export const DescriptorSchema = z.object({
  descriptor: z.string().refine((value) => wordCount(value) >= 60 && wordCount(value) <= 120, {
    message: 'descriptor must be 60–120 words',
  }),
  anchors: z.array(z.string().min(1)).min(3).max(5),
  negative_traits: z.array(z.string().min(1)).max(3).default([]),
  palette_hex: z.array(z.string().regex(HEX)).max(4).default([]),
  gendered_noun: z.enum(['woman', 'man', 'person', 'figure']),
});
export type Descriptor = z.infer<typeof DescriptorSchema>;

export interface DescribeOptions {
  imageUrls: string[];
  apiKey: string;
  model?: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

interface ChatCompletion {
  choices?: Array<{ message?: { content?: string } }>;
}

// Extract the JSON object from a model reply that may wrap it in prose or a fence.
function parseJsonReply(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1]! : content;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new KilnryError('PROVIDER_ERROR', 'The description model did not return JSON.', {
      retryable: true,
    });
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as unknown;
  } catch (error) {
    throw new KilnryError('PROVIDER_ERROR', 'The description model returned malformed JSON.', {
      retryable: true,
      cause: error,
    });
  }
}

/**
 * Generate an appearance descriptor for a Character from one or more image URLs
 * with the cheapest vision-language model on OpenRouter (F-CHR-05, TRD-14 §8).
 * The result is validated against DescriptorSchema and is editable afterwards.
 */
export async function generateDescriptor(options: DescribeOptions): Promise<Descriptor> {
  if (options.imageUrls.length === 0) {
    throw new KilnryError('INVALID_INPUT', 'At least one image is needed to describe a Character.');
  }
  const requestFetch = options.fetch ?? fetch;
  const body = {
    model: options.model ?? DESCRIPTOR_MODEL,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: DESCRIPTOR_PROMPT },
          ...options.imageUrls.map((url) => ({ type: 'image_url', image_url: { url } })),
        ],
      },
    ],
    response_format: { type: 'json_object' },
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
    throw new KilnryError('PROVIDER_ERROR', 'Could not reach the description model.', {
      retryable: true,
      provider: 'openrouter',
      cause: error,
    });
  }
  if (!response.ok) {
    throw new KilnryError('PROVIDER_ERROR', `The description model failed (${response.status}).`, {
      retryable: response.status >= 500 || response.status === 429,
      provider: 'openrouter',
    });
  }
  const completion = (await response.json()) as ChatCompletion;
  const content = completion.choices?.[0]?.message?.content;
  if (!content) {
    throw new KilnryError('PROVIDER_ERROR', 'The description model returned no content.', {
      retryable: true,
    });
  }
  const parsed = DescriptorSchema.safeParse(parseJsonReply(content));
  if (!parsed.success) {
    throw new KilnryError('PROVIDER_ERROR', 'The description did not match the expected shape.', {
      retryable: true,
      details: parsed.error.issues,
    });
  }
  return parsed.data;
}

/**
 * Validate an edited descriptor (F-CHR-05: the description is editable in the
 * Character detail and edits create a new version). Returns the parsed value or
 * throws INVALID_INPUT with the reasons.
 */
export function validateDescriptor(input: unknown): Descriptor {
  const parsed = DescriptorSchema.safeParse(input);
  if (!parsed.success) {
    throw new KilnryError('INVALID_INPUT', 'This description is not valid.', {
      details: parsed.error.issues,
    });
  }
  return parsed.data;
}

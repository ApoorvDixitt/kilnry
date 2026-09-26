// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Look at media, or reason over text, for kilnry_analyze (F-MCP-02, TRD-12 §4).
// With one or more references it is a vision-language-model (VLM) task; with no
// references and a prompt it is a text-only large-language-model (LLM) call that
// uses the same OpenRouter chat route and the same default model Chat resolves
// to. A schema forces structured JSON, validated against that schema with one
// repair retry; the qa_check and consistency_check tasks also report a numeric
// score and a confidence badge the caller can act on.

import { KilnryError } from '../errors.js';
import { DESCRIPTOR_MODEL } from './descriptor.js';

// The analyze tasks this helper serves. describe/caption/tag are free-form text;
// ocr reads text; qa_check/consistency_check/score judge and return a score and
// a badge. transcribe_local runs on the machine and is handled by the caller.
export const ANALYZE_TASKS = [
  'describe',
  'caption',
  'tag',
  'ocr',
  'qa_check',
  'consistency_check',
  'score',
] as const;
export type AnalyzeTask = (typeof ANALYZE_TASKS)[number];

export function isSupportedAnalyzeTask(task: string): task is AnalyzeTask {
  return (ANALYZE_TASKS as readonly string[]).includes(task);
}

// The tasks that return a numeric score in [0, 1] and a confidence badge.
const SCORED_TASKS = new Set<AnalyzeTask>(['qa_check', 'consistency_check', 'score']);

// The cheapest vision-language model, chosen when the caller asks for 'auto'.
// It is the same model the appearance descriptor and Chat's default resolve to
// (google/gemini-3.1-flash-lite), so analyze prices and behaves like the rest.
export const CHEAPEST_VLM = DESCRIPTOR_MODEL;
export const DEFAULT_ANALYZE_MODEL = DESCRIPTOR_MODEL;

const TASK_PROMPT: Record<AnalyzeTask, string> = {
  describe:
    'Describe what is in the image or images plainly and specifically in two or three sentences. No preamble.',
  caption: 'Write one short caption for the image, under 20 words. No quotation marks, no preamble.',
  tag: 'List five to ten short lower-case tags for the image, comma-separated. No preamble.',
  ocr: 'Read and transcribe every piece of visible text exactly, in reading order. No preamble.',
  qa_check:
    'Judge whether the media meets the instruction. Reply with a JSON object {"ok": boolean, "score": number between 0 and 1, "reasons": string[]}. Be strict.',
  consistency_check:
    'Judge whether the media is consistent with the described subject or reference. Reply with a JSON object {"ok": boolean, "score": number between 0 and 1, "reasons": string[]}.',
  score:
    'Score the media against the instruction. Reply with a JSON object {"score": number between 0 and 1, "notes": string}.',
};

interface ChatCompletion {
  choices?: Array<{ message?: { content?: string } }>;
}

export interface AnalyzeOptions {
  task: AnalyzeTask;
  imageUrls: string[];
  apiKey: string;
  instructions?: string;
  // A JSON Schema the reply must satisfy. When given, the model is asked for a
  // JSON object and the parsed value is validated against the schema; one repair
  // retry follows a failed validation before the call gives up.
  schema?: Record<string, unknown>;
  model?: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

export interface AnalyzeResult {
  text: string;
  model: string;
  structured?: unknown;
  score?: number;
  badge?: 'high' | 'medium' | 'low';
}

// Extract the first JSON object from a reply that may wrap it in prose or a
// fenced block. Mirrors the descriptor's parser so analyze and the descriptor
// read a model's JSON the same way.
function parseJsonReply(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1]! : content;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new KilnryError('PROVIDER_ERROR', 'The analysis model did not return JSON.', { retryable: true });
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as unknown;
  } catch (error) {
    throw new KilnryError('PROVIDER_ERROR', 'The analysis model returned malformed JSON.', {
      retryable: true,
      cause: error,
    });
  }
}

// A tiny JSON Schema check covering the subset the shipped workflows use: an
// object with required keys and each property's primitive type. It exists so a
// schema-forced analyze step validates its structured output without pulling in
// a full JSON Schema engine; unknown constructs are treated as satisfied.
export function validateAgainstSchema(value: unknown, schema: Record<string, unknown>): string[] {
  const issues: string[] = [];
  const type = schema.type as string | undefined;
  if (type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return ['expected an object'];
    }
    const record = value as Record<string, unknown>;
    const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
    for (const key of required) {
      if (!(key in record)) issues.push(`missing required property "${key}"`);
    }
    const properties = (schema.properties as Record<string, Record<string, unknown>>) ?? {};
    for (const [key, propSchema] of Object.entries(properties)) {
      if (key in record)
        issues.push(...validateAgainstSchema(record[key], propSchema).map((m) => `${key}: ${m}`));
    }
    return issues;
  }
  if (type === 'array') {
    if (!Array.isArray(value)) return ['expected an array'];
    const itemSchema = schema.items as Record<string, unknown> | undefined;
    if (itemSchema) {
      for (const [i, item] of value.entries()) {
        issues.push(...validateAgainstSchema(item, itemSchema).map((m) => `[${i}]: ${m}`));
      }
    }
    return issues;
  }
  if (type === 'string' && typeof value !== 'string') return ['expected a string'];
  if (type === 'number' && typeof value !== 'number') return ['expected a number'];
  if (type === 'integer' && (typeof value !== 'number' || !Number.isInteger(value))) {
    return ['expected an integer'];
  }
  if (type === 'boolean' && typeof value !== 'boolean') return ['expected a boolean'];
  return issues;
}

function badgeFor(score: number | undefined): 'high' | 'medium' | 'low' | undefined {
  if (score === undefined) return undefined;
  if (score >= 0.8) return 'high';
  if (score >= 0.5) return 'medium';
  return 'low';
}

async function callOpenRouter(options: AnalyzeOptions, prompt: string, wantJson: boolean): Promise<string> {
  const model = options.model && options.model !== 'auto' ? options.model : DEFAULT_ANALYZE_MODEL;
  const requestFetch = options.fetch ?? fetch;
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: prompt }];
  for (const url of options.imageUrls) content.push({ type: 'image_url', image_url: { url } });
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: 'user', content }],
    ...(wantJson ? { response_format: { type: 'json_object' } } : {}),
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
  return text;
}

/**
 * Run one analyze task over the given media URLs (or over text alone when no
 * URLs are given) and return the model's text and, when a schema or a scored
 * task asks for it, a structured object with a score and a confidence badge.
 * A schema-forced call parses and validates the JSON and retries once with the
 * validation errors before giving up. Never throws for a normal provider
 * failure without a clear message; callers wrap it into a structured tool error.
 */
export async function analyzeMedia(options: AnalyzeOptions): Promise<AnalyzeResult> {
  const instructions = options.instructions ? ` ${options.instructions}` : '';
  if (options.imageUrls.length === 0 && instructions.trim() === '' && !SCORED_TASKS.has(options.task)) {
    throw new KilnryError(
      'INVALID_INPUT',
      'Give at least one reference or an instruction for the analysis to act on.',
    );
  }
  const model = options.model && options.model !== 'auto' ? options.model : DEFAULT_ANALYZE_MODEL;
  const wantJson = options.schema !== undefined || SCORED_TASKS.has(options.task);
  const basePrompt = `${TASK_PROMPT[options.task]}${instructions}`;
  const prompt = options.schema
    ? `${basePrompt}\nReturn only a JSON object matching this schema: ${JSON.stringify(options.schema)}`
    : basePrompt;

  const text = await callOpenRouter(options, prompt, wantJson);
  if (!wantJson) return { text, model };

  let structured = parseJsonReply(text);
  if (options.schema) {
    let issues = validateAgainstSchema(structured, options.schema);
    if (issues.length > 0) {
      // One repair retry: hand the model its own reply and the validation errors.
      const repairPrompt = `${prompt}\nYour previous reply did not satisfy the schema: ${issues.join('; ')}. Return corrected JSON only.`;
      const repaired = await callOpenRouter({ ...options }, repairPrompt, true);
      const reparsed = parseJsonReply(repaired);
      issues = validateAgainstSchema(reparsed, options.schema);
      if (issues.length > 0) {
        throw new KilnryError(
          'PROVIDER_ERROR',
          `The analysis did not match the schema: ${issues.join('; ')}.`,
          {
            retryable: true,
          },
        );
      }
      structured = reparsed;
    }
  }
  const scoreValue =
    structured && typeof structured === 'object' && 'score' in (structured as Record<string, unknown>)
      ? Number((structured as Record<string, unknown>).score)
      : undefined;
  const score = scoreValue !== undefined && Number.isFinite(scoreValue) ? scoreValue : undefined;
  return {
    text,
    model,
    structured,
    ...(score === undefined ? {} : { score }),
    ...(badgeFor(score) === undefined ? {} : { badge: badgeFor(score)! }),
  };
}

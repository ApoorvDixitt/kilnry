// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import {
  ANALYZE_TASKS,
  CHEAPEST_VLM,
  DEFAULT_ANALYZE_MODEL,
  analyzeMedia,
  isSupportedAnalyzeTask,
  validateAgainstSchema,
} from './analyze.js';

function mockFetch(text: string): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch;
}

// A fetch that returns a different reply on each call, so a repair retry can be
// driven: the first reply is malformed against the schema, the second is valid.
function sequenceFetch(texts: string[]): typeof fetch {
  let call = 0;
  return (async () =>
    new Response(
      JSON.stringify({ choices: [{ message: { content: texts[Math.min(call++, texts.length - 1)] } }] }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    )) as unknown as typeof fetch;
}

describe('analyzeMedia (F-MCP-02, TRD-12 §4)', () => {
  it('supports the workflow task set and defaults to the cheapest vision model', () => {
    expect(ANALYZE_TASKS).toContain('describe');
    expect(ANALYZE_TASKS).toContain('qa_check');
    expect(ANALYZE_TASKS).toContain('consistency_check');
    expect(isSupportedAnalyzeTask('describe')).toBe(true);
    expect(isSupportedAnalyzeTask('detect_faces')).toBe(false);
    expect(CHEAPEST_VLM).toContain('gemini');
    expect(DEFAULT_ANALYZE_MODEL).toContain('gemini');
  });

  it('describes an image and returns the model used', async () => {
    const result = await analyzeMedia({
      task: 'describe',
      imageUrls: ['http://127.0.0.1:3123/api/media/a1'],
      apiKey: 'sk-test',
      model: 'auto',
      fetch: mockFetch('A calm woman in soft light.'),
    });
    expect(result.text).toBe('A calm woman in soft light.');
    expect(result.model).toBe(DEFAULT_ANALYZE_MODEL);
  });

  it('runs a text-only call with no references and the default model', async () => {
    const result = await analyzeMedia({
      task: 'describe',
      imageUrls: [],
      instructions: 'Summarise the brand voice in one line.',
      apiKey: 'sk-test',
      fetch: mockFetch('Warm, plain, confident.'),
    });
    expect(result.text).toBe('Warm, plain, confident.');
    expect(result.model).toBe(DEFAULT_ANALYZE_MODEL);
  });

  it('refuses when given neither a reference nor an instruction', async () => {
    await expect(
      analyzeMedia({ task: 'describe', imageUrls: [], apiKey: 'sk', fetch: mockFetch('x') }),
    ).rejects.toThrow();
  });

  it('checks a value against a small JSON Schema', () => {
    const schema = {
      type: 'object',
      required: ['ok', 'score'],
      properties: { ok: { type: 'boolean' }, score: { type: 'number' } },
    };
    expect(validateAgainstSchema({ ok: true, score: 0.9 }, schema)).toEqual([]);
    expect(validateAgainstSchema({ ok: true }, schema)).toContain('missing required property "score"');
    expect(validateAgainstSchema({ ok: 'yes', score: 0.9 }, schema)).toContain('ok: expected a boolean');
  });

  it('returns structured JSON with a score and a badge for a scored task', async () => {
    const result = await analyzeMedia({
      task: 'qa_check',
      imageUrls: ['http://127.0.0.1:3123/api/media/a1'],
      instructions: 'Is the label legible?',
      apiKey: 'sk-test',
      fetch: mockFetch('{"ok": true, "score": 0.92, "reasons": ["clear"]}'),
    });
    expect((result.structured as { ok: boolean }).ok).toBe(true);
    expect(result.score).toBeCloseTo(0.92);
    expect(result.badge).toBe('high');
  });

  it('validates a schema-forced reply and repairs it once', async () => {
    const schema = {
      type: 'object',
      required: ['ok', 'score'],
      properties: { ok: { type: 'boolean' }, score: { type: 'number' } },
    };
    const result = await analyzeMedia({
      task: 'qa_check',
      imageUrls: ['http://127.0.0.1:3123/api/media/a1'],
      apiKey: 'sk-test',
      schema,
      // First reply is missing "score"; the repair retry returns a valid object.
      fetch: sequenceFetch(['{"ok": true}', '{"ok": true, "score": 0.7}']),
    });
    expect((result.structured as { score: number }).score).toBe(0.7);
    expect(result.badge).toBe('medium');
  });

  it('gives up after one failed repair', async () => {
    const schema = { type: 'object', required: ['score'], properties: { score: { type: 'number' } } };
    await expect(
      analyzeMedia({
        task: 'qa_check',
        imageUrls: ['http://127.0.0.1:3123/api/media/a1'],
        apiKey: 'sk-test',
        schema,
        fetch: sequenceFetch(['{"ok": true}', '{"ok": false}']),
      }),
    ).rejects.toThrow();
  });
});

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { ANALYZE_TASKS, CHEAPEST_VLM, analyzeMedia, isSupportedAnalyzeTask } from './analyze.js';

function mockFetch(text: string): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch;
}

describe('analyzeMedia (F-MCP-02)', () => {
  it('supports describe and caption, defaults to the cheapest vision model', () => {
    expect(ANALYZE_TASKS).toEqual(['describe', 'caption']);
    expect(isSupportedAnalyzeTask('describe')).toBe(true);
    expect(isSupportedAnalyzeTask('ocr')).toBe(false);
    expect(CHEAPEST_VLM).toContain('gemini');
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
    expect(result.model).toBe(CHEAPEST_VLM);
  });

  it('refuses with no images', async () => {
    await expect(
      analyzeMedia({ task: 'caption', imageUrls: [], apiKey: 'sk', fetch: mockFetch('x') }),
    ).rejects.toThrow();
  });
});

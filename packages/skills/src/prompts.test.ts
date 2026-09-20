// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const prompts = join(dirname(fileURLToPath(import.meta.url)), '..', 'prompts');

// Strip the leading HTML-comment licence header the runtime loader removes, so
// the budget is measured against the prompt the model actually receives.
function promptBody(file: string): string {
  return readFileSync(join(prompts, file), 'utf8')
    .replace(/^<!--[\s\S]*?-->\n?/, '')
    .trim();
}

// A token estimate without a tokenizer dependency, using the widely used ratio
// of about 0.75 English words per token (so tokens ≈ words × 1.33). This tracks
// real GPT tokenisation of prose far better than a raw character count, which
// over-counts Markdown punctuation. PRD-13 §1 states the prompt is about 1,250
// tokens; the limit is 1,300.
function estimateTokens(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.ceil(words * 1.33);
}

describe('prompt library (F-SKL-05)', () => {
  it('ships the base system prompt with a token count at or under 1300 (PRD-13 §1)', () => {
    const body = promptBody('base-system.md');
    expect(body.startsWith('You are Kilnry')).toBe(true);
    expect(estimateTokens(body)).toBeLessThanOrEqual(1300);
  });

  it('ships the three per-mode addenda', () => {
    for (const mode of ['ask-first', 'run-automatically', 'offline']) {
      expect(existsSync(join(prompts, 'modes', `${mode}.md`))).toBe(true);
      expect(promptBody(join('modes', `${mode}.md`)).startsWith('Mode:')).toBe(true);
    }
  });

  it('ships the six per-model prompt guides (PRD-13 §3)', () => {
    for (const model of ['seedance', 'kling', 'minimax-h3', 'veo', 'nano-banana', 'gpt-image']) {
      const body = promptBody(join('models', `${model}.md`));
      expect(body.length).toBeGreaterThan(0);
      expect(body).toContain('Example 1:');
    }
  });
});

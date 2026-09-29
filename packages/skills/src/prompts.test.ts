// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encode } from 'gpt-tokenizer/model/gpt-4o';
import { describe, expect, it } from 'vitest';

const prompts = join(dirname(fileURLToPath(import.meta.url)), '..', 'prompts');

// Strip the leading HTML-comment licence header the runtime loader removes, so
// the budget is measured against the prompt the model actually receives.
function promptBody(file: string): string {
  return readFileSync(join(prompts, file), 'utf8')
    .replace(/^<!--[\s\S]*?-->\n?/, '')
    .trim();
}

// Measure the real token count with the gpt-tokenizer o200k_base encoding used
// by the current GPT-4o / GPT-image family (M5 default revisited in M6: the
// earlier words × 1.33 ratio only approximated this). The sixteen skills and the
// flagship texts enter the instructions assembly at TRD-11 §3, so the base
// budget the assembly starts from must be measured, not estimated.
function countTokens(text: string): number {
  return encode(text).length;
}

describe('prompt library (F-SKL-05)', () => {
  it('ships the base system prompt at the measured 1,215 tokens, inside the 1,300 budget (PRD-13 §1, F-SKL-05)', () => {
    const body = promptBody('base-system.md');
    expect(body.startsWith('You are Kilnry')).toBe(true);
    // The o200k_base count is the figure 8e07a71 recorded — 1,215 tokens, close
    // to PRD-13 §1's ~1,250 and inside the 1,300 budget the instructions assembly
    // starts from. Asserting the measured number, not only the ceiling, so a
    // change to the base prompt that moves the budget is caught here.
    expect(countTokens(body)).toBe(1215);
    expect(countTokens(body)).toBeLessThanOrEqual(1300);
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

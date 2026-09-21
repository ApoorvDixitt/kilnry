// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  applyLoadedSkill,
  assembleInstructions,
  BLOCK_BUDGETS,
  buildSkillsIndex,
  promptsRootFrom,
  renderPrompt,
  skillSystemMessage,
  touchLoadedSkill,
  type SkillIndexEntry,
} from './instructions.js';

// The real shipped prompt library, so the assembly is tested against the same
// files the runtime reads (packages/skills/prompts).
const promptsRoot = promptsRootFrom(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills'));

const baseVars = {
  today: '2026-09-21',
  library_root: '~/Kilnry',
  folder: 'Campaign_A',
  autonomy: 'ask_first' as const,
  auto_approve_below_usd: 0.5,
  session_budget_usd: 5,
  session_spent_usd: 1.2,
  budget_remaining_usd: 3.8,
  characters_list: '@maya (character, v2, voice: elevenlabs)',
  providers_connected: 'fal, openrouter',
  llm_name: 'anthropic/claude-sonnet-5',
  llm_price: '$2 / $10 per M',
  language_hint: 'en',
};

describe('renderPrompt (F-CHT-07)', () => {
  it('substitutes ${name} placeholders the shipped mode files use', () => {
    const out = renderPrompt('threshold is ${auto_approve_below_usd}', baseVars);
    expect(out).toBe('threshold is 0.5');
  });

  it('substitutes {{ name }} and the money filter', () => {
    const out = renderPrompt('remaining {{ budget_remaining_usd | money }}', baseVars);
    expect(out).toBe('remaining $3.80');
  });

  it('renders an unknown variable as empty and records a warning', () => {
    const warnings: string[] = [];
    const out = renderPrompt('x=${nope}', baseVars, { warnings });
    expect(out).toBe('x=');
    expect(warnings.some((w) => w.includes('nope'))).toBe(true);
  });
});

describe('buildSkillsIndex (F-CHT-06, block 4)', () => {
  const skills: SkillIndexEntry[] = [
    { name: 'kilnry-thumbnail', description: 'Make a click-worthy thumbnail.', usage_count: 1 },
    { name: 'kilnry-ugc-ad', description: 'Plan and run a creator-style UGC ad.', usage_count: 9 },
    { name: 'kilnry-subtitles', description: 'Transcribe and burn captions.', usage_count: 5 },
  ];

  it('orders by usage this month then alphabetically and formats each line', () => {
    const index = buildSkillsIndex(skills);
    const names = index.split('\n').map((l) => l.slice(2, l.indexOf(':')));
    expect(names).toEqual(['kilnry-ugc-ad', 'kilnry-subtitles', 'kilnry-thumbnail']);
    expect(index.startsWith('- kilnry-ugc-ad: Plan and run')).toBe(true);
  });

  it('truncates a long description to 120 characters', () => {
    const long = [{ name: 'x', description: 'a'.repeat(400) }];
    const line = buildSkillsIndex(long);
    // "- x: " prefix + 119 chars + ellipsis.
    expect(line.length).toBeLessThan(400);
    expect(line.endsWith('…')).toBe(true);
  });

  it('keeps the block under budget and appends an overflow line', () => {
    const many: SkillIndexEntry[] = Array.from({ length: 200 }, (_, i) => ({
      name: `kilnry-skill-${i.toString().padStart(3, '0')}`,
      description: `A seed skill number ${i} that does a specific useful media production task.`,
      usage_count: 0,
    }));
    const index = buildSkillsIndex(many);
    expect(Buffer.byteLength(index, 'utf8')).toBeLessThanOrEqual(BLOCK_BUDGETS.skills);
    expect(index).toMatch(/…and \d+ more; call kilnry_skills list$/);
  });

  it('returns empty for no skills', () => {
    expect(buildSkillsIndex([])).toBe('');
  });
});

describe('assembleInstructions (F-CHT-07, TRD-11 §3)', () => {
  it('assembles the blocks in order and keeps the base prompt under 6 KB', () => {
    const { instructions, blocks } = assembleInstructions({
      promptsRoot,
      autonomy: 'ask_first',
      vars: baseVars,
      routingTable: '| Task | Model | Price |\n|---|---|---|\n| Image | GPT Image 2.5 | $0.04 |',
      skills: [{ name: 'kilnry-ugc-ad', description: 'Plan and run a creator-style UGC ad.' }],
      memoryBody: '## Brand facts\n- Product: masala chai premix.',
    });
    expect(blocks.base.startsWith('You are Kilnry')).toBe(true);
    expect(Buffer.byteLength(blocks.base, 'utf8')).toBeLessThanOrEqual(BLOCK_BUDGETS.base);
    // Block order: base, mode, routing, skills, memory, runtime.
    const iBase = instructions.indexOf('You are Kilnry');
    const iMode = instructions.indexOf('Mode: Ask me first');
    const iRouting = instructions.indexOf('## Routing right now');
    const iSkills = instructions.indexOf('## Skills you can load');
    const iMemory = instructions.indexOf('## Project memory');
    const iRuntime = instructions.indexOf('## Right now');
    expect(iBase).toBeGreaterThanOrEqual(0);
    expect(iMode).toBeGreaterThan(iBase);
    expect(iRouting).toBeGreaterThan(iMode);
    expect(iSkills).toBeGreaterThan(iRouting);
    expect(iMemory).toBeGreaterThan(iSkills);
    expect(iRuntime).toBeGreaterThan(iMemory);
  });

  it('renders the ask-first threshold from the ${...} placeholder', () => {
    const { blocks } = assembleInstructions({ promptsRoot, autonomy: 'ask_first', vars: baseVars });
    expect(blocks.mode).toContain('currently 0.5');
    expect(blocks.mode).not.toContain('${');
  });

  it('appends the offline addendum for a local model', () => {
    const { blocks } = assembleInstructions({
      promptsRoot,
      autonomy: 'run_automatically',
      offline: true,
      vars: { ...baseVars, autonomy: 'run_automatically' },
    });
    expect(blocks.mode).toContain('Mode: Run automatically');
    expect(blocks.mode).toContain('Mode: Offline');
  });

  it('truncates project memory with the exact 4 KB marker', () => {
    const { blocks } = assembleInstructions({
      promptsRoot,
      autonomy: 'ask_first',
      vars: baseVars,
      memoryBody: 'm'.repeat(8 * 1024),
    });
    expect(Buffer.byteLength(blocks.memory, 'utf8')).toBeLessThanOrEqual(BLOCK_BUDGETS.memory);
    expect(blocks.memory.endsWith('[…memory truncated at 4 KB; open the file to edit]')).toBe(true);
  });

  it('omits empty optional blocks (no routing, skills, or memory)', () => {
    const { instructions } = assembleInstructions({ promptsRoot, autonomy: 'ask_first', vars: baseVars });
    expect(instructions).not.toContain('## Routing right now');
    expect(instructions).not.toContain('## Skills you can load');
    expect(instructions).not.toContain('## Project memory');
  });
});

describe('discover-then-load window (F-CHT-06, TRD-11 §6)', () => {
  it('wraps a loaded skill body as a system message', () => {
    const msg = skillSystemMessage('kilnry-ugc-ad', '1.2.0', 'Do the thing.');
    expect(msg).toBe('<skill name="kilnry-ugc-ad" version="1.2.0">\nDo the thing.\n</skill>');
  });

  it('evicts the least recently referenced skill when a fourth loads', () => {
    let loaded = applyLoadedSkill([], { name: 'a', version: '1' }, 100).loaded;
    loaded = applyLoadedSkill(loaded, { name: 'b', version: '1' }, 200).loaded;
    loaded = applyLoadedSkill(loaded, { name: 'c', version: '1' }, 300).loaded;
    // Reference 'a' so 'b' becomes the least recently used.
    loaded = touchLoadedSkill(loaded, 'a', 400);
    const fourth = applyLoadedSkill(loaded, { name: 'd', version: '1' }, 500);
    expect(fourth.evicted).toBe('b');
    expect(fourth.loaded.map((s) => s.name).sort()).toEqual(['a', 'c', 'd']);
  });

  it('re-loading an already-loaded skill refreshes it without growing the window', () => {
    let loaded = applyLoadedSkill([], { name: 'a', version: '1' }, 100).loaded;
    loaded = applyLoadedSkill(loaded, { name: 'b', version: '1' }, 200).loaded;
    const again = applyLoadedSkill(loaded, { name: 'a', version: '2' }, 300);
    expect(again.evicted).toBeUndefined();
    expect(again.loaded).toHaveLength(2);
    expect(again.loaded.find((s) => s.name === 'a')?.version).toBe('2');
  });
});

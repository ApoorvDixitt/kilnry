// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseSkillFrontmatter } from './frontmatter.js';
import { validateSkill } from './validate.js';
import { listSkills, loadSkill, loadSkillFile } from './loader.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const GOOD_SKILL = `---
name: kilnry-ugc-ad
description: >
  Plan and run a creator-style UGC ad as one vertical video with a truthful-claims gate.
  Use when the user asks for a UGC ad, creator video, or "make an ad for this product".
license: Sustainable-Use-1.0
metadata:
  author: kilnry
  version: 1.2.0
  kilnry:
    pipeline: kilnry-ugc-ad
    requires_capabilities: [text2image, reference2video]
    cost_hint: "about 3 to 6 dollars"
    version: 1.2.0
    tags: [ads, ugc, video]
    triggers: ["ugc ad", "creator video"]
    presets: [ugc-hook-talking-head]
---

# UGC Ad

Call kilnry_workflows plan, state the total, and wait for consent unless the workspace runs automatically.

## Plan
Gate: the claims are approved.
Read references/board.md for the layout.
`,
  BOARD = '# Board\n\nEight-slot layout.\n';

function makeSkill(dirName: string, skillMd: string, extras: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'kilnry-skills-'));
  roots.push(root);
  const dir = join(root, dirName);
  mkdirSync(join(dir, 'references'), { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), skillMd);
  for (const [path, content] of Object.entries(extras)) {
    writeFileSync(join(dir, path), content);
  }
  return root;
}

describe('skill frontmatter parser (F-SKL-01)', () => {
  it('parses scalars, a folded description, a nested kilnry block, and arrays', () => {
    const parsed = parseSkillFrontmatter(GOOD_SKILL);
    expect(parsed?.name).toBe('kilnry-ugc-ad');
    expect(String(parsed?.description)).toContain('Use when the user asks');
    const metadata = parsed?.metadata as { kilnry?: Record<string, unknown> };
    expect(metadata.kilnry?.pipeline).toBe('kilnry-ugc-ad');
    expect(metadata.kilnry?.requires_capabilities).toEqual(['text2image', 'reference2video']);
    expect(metadata.kilnry?.tags).toEqual(['ads', 'ugc', 'video']);
    expect(metadata.kilnry?.version).toBe('1.2.0');
  });
});

describe('skill validator (F-SKL-01)', () => {
  it('accepts a well-formed skill with no errors', () => {
    const parsed = parseSkillFrontmatter(GOOD_SKILL);
    const issues = validateSkill({ dirName: 'kilnry-ugc-ad', frontmatter: parsed, body: 'body use when x' });
    expect(issues.filter((issue) => issue.level === 'error')).toEqual([]);
  });

  it('errors when the name does not match the folder', () => {
    const parsed = parseSkillFrontmatter(GOOD_SKILL);
    const issues = validateSkill({ dirName: 'other-name', frontmatter: parsed, body: 'x' });
    expect(issues.some((issue) => issue.rule === 'V2' && issue.level === 'error')).toBe(true);
  });

  it('errors when the body carries a provider prompt token', () => {
    const parsed = parseSkillFrontmatter(GOOD_SKILL);
    const issues = validateSkill({
      dirName: 'kilnry-ugc-ad',
      frontmatter: parsed,
      body: 'inject <<< maya >>> here',
    });
    expect(issues.some((issue) => issue.rule === 'V10' && issue.level === 'error')).toBe(true);
  });

  it('warns when the body tells the agent to skip cost confirmation', () => {
    const parsed = parseSkillFrontmatter(GOOD_SKILL);
    const issues = validateSkill({
      dirName: 'kilnry-ugc-ad',
      frontmatter: parsed,
      body: 'generate without asking the user',
    });
    expect(issues.some((issue) => issue.rule === 'V11' && issue.level === 'warning')).toBe(true);
  });
});

describe('skill loader (F-SKL-01)', () => {
  it('lists a valid skill with its description, tags and pipeline flag', async () => {
    const root = makeSkill('kilnry-ugc-ad', GOOD_SKILL, { 'references/board.md': BOARD });
    const skills = await listSkills({ bundled: root });
    expect(skills).toHaveLength(1);
    expect(skills[0]?.name).toBe('kilnry-ugc-ad');
    expect(skills[0]?.enabled).toBe(true);
    expect(skills[0]?.has_pipeline).toBe(true);
    expect(skills[0]?.tags).toEqual(['ads', 'ugc', 'video']);
    expect(skills[0]?.files).toContain('references/board.md');
  });

  it('loads a skill body and a referenced file, and contains the read to the folder', async () => {
    const root = makeSkill('kilnry-ugc-ad', GOOD_SKILL, { 'references/board.md': BOARD });
    const detail = await loadSkill({ bundled: root }, 'kilnry-ugc-ad');
    expect(detail?.body_markdown).toContain('# UGC Ad');
    const file = await loadSkillFile({ bundled: root }, 'kilnry-ugc-ad', 'references/board.md');
    expect(file?.content).toContain('Eight-slot layout');
    const escape = await loadSkillFile({ bundled: root }, 'kilnry-ugc-ad', '../../../etc/passwd');
    expect(escape).toBeNull();
  });

  it('lists a malformed skill as disabled with its first error', async () => {
    const bad = GOOD_SKILL.replace('name: kilnry-ugc-ad', 'name: wrong-name');
    const root = makeSkill('kilnry-ugc-ad', bad);
    const skills = await listSkills({ bundled: root });
    expect(skills[0]?.enabled).toBe(false);
    expect(skills[0]?.error).toContain('folder name');
  });

  it('returns an empty list for a missing skills root', async () => {
    expect(await listSkills({ bundled: join(tmpdir(), 'does-not-exist-kilnry') })).toEqual([]);
  });

  it('marks a disabled skill not enabled and refuses to load it (F-SKL-04)', async () => {
    const root = makeSkill('kilnry-ugc-ad', GOOD_SKILL, { 'references/board.md': BOARD });
    const disabled = new Set(['kilnry-ugc-ad']);
    const skills = await listSkills({ bundled: root, disabled });
    expect(skills[0]?.enabled).toBe(false);
    // A disabled skill cannot be loaded, so the agent never sees its body.
    expect(await loadSkill({ bundled: root, disabled }, 'kilnry-ugc-ad')).toBeNull();
  });
});

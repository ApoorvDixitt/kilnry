// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseSkillFrontmatter } from './frontmatter.js';
import { validateSkill, validateSkillFolder } from './validate.js';
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
    const skills = await listSkills({ bundled: root, validators: { pipelineInCatalogue: () => true } });
    expect(skills).toHaveLength(1);
    expect(skills[0]?.name).toBe('kilnry-ugc-ad');
    expect(skills[0]?.enabled).toBe(true);
    expect(skills[0]?.has_pipeline).toBe(true);
    expect(skills[0]?.tags).toEqual(['ads', 'ugc', 'video']);
    expect(skills[0]?.files).toContain('references/board.md');
  });

  it('loads a skill body and a referenced file, and contains the read to the folder', async () => {
    const root = makeSkill('kilnry-ugc-ad', GOOD_SKILL, { 'references/board.md': BOARD });
    const validators = { pipelineInCatalogue: () => true };
    const detail = await loadSkill({ bundled: root, validators }, 'kilnry-ugc-ad');
    expect(detail?.body_markdown).toContain('# UGC Ad');
    const file = await loadSkillFile({ bundled: root, validators }, 'kilnry-ugc-ad', 'references/board.md');
    expect(file?.content).toContain('Eight-slot layout');
    const escape = await loadSkillFile({ bundled: root, validators }, 'kilnry-ugc-ad', '../../../etc/passwd');
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

describe('skill folder validator (F-SKL-03, TRD-13 §4)', () => {
  const baseFm = {
    name: 'acme-helper',
    description: 'A helper skill. Use when a test needs one.',
    license: 'MIT',
    metadata: { version: '1.0.0', kilnry: { version: '1.0.0' } },
  };
  const rules = (issues: ReturnType<typeof validateSkillFolder>): string[] =>
    issues.map((issue) => issue.rule);

  it('V6 errors when the body references a file not in the folder', () => {
    const issues = validateSkillFolder({
      frontmatter: baseFm,
      body: 'Read `references/missing.md` for details.',
      files: ['SKILL.md'],
    });
    expect(rules(issues)).toContain('V6');
  });

  it('V6 errors on an unsafe path and accepts a glob with a match', () => {
    const escape = validateSkillFolder({
      frontmatter: baseFm,
      body: 'See `references/../secret.md`.',
      files: ['SKILL.md'],
    });
    expect(rules(escape)).toContain('V6');
    const glob = validateSkillFolder({
      frontmatter: baseFm,
      body: 'Pick a look from `references/looks/*.md`.',
      files: ['SKILL.md', 'references/looks/clean.md'],
    });
    expect(rules(glob)).not.toContain('V6');
  });

  it('V7 rejects a non-JSON file under scripts/ and an invalid pipeline', () => {
    const exe = validateSkillFolder({
      frontmatter: baseFm,
      body: 'body',
      files: ['SKILL.md', 'scripts/run.py'],
    });
    expect(rules(exe)).toContain('V7');
    const badJson = validateSkillFolder({
      frontmatter: baseFm,
      body: 'body',
      files: ['SKILL.md', 'scripts/x.json'],
      readTextFile: () => '{"schema_version": 2}',
    });
    expect(rules(badJson)).toContain('V7');
  });

  it('V7 accepts a valid declarative pipeline', () => {
    const pipeline = JSON.stringify({
      schema_version: 1,
      name: 'caption-burn',
      description: 'Transcribe then burn captions.',
      inputs: { video: { type: 'media', required: true } },
      steps: [{ id: 's1', tool: 'kilnry_ffmpeg', op: 'burn_captions', inputs: ['{{ inputs.video }}'] }],
      output: '{{ steps.s1.asset }}',
    });
    const issues = validateSkillFolder({
      frontmatter: baseFm,
      body: 'body',
      files: ['SKILL.md', 'scripts/caption-burn.json'],
      readTextFile: () => pipeline,
    });
    expect(rules(issues)).not.toContain('V7');
  });

  it('V8 errors when the linked pipeline does not resolve, passes when it does', () => {
    const fm = { ...baseFm, metadata: { kilnry: { version: '1.0.0', pipeline: 'kilnry-ghost' } } };
    const missing = validateSkillFolder({ frontmatter: fm, body: 'body', files: ['SKILL.md'] });
    expect(rules(missing)).toContain('V8');
    const resolved = validateSkillFolder({
      frontmatter: fm,
      body: 'body',
      files: ['SKILL.md'],
      pipelineInCatalogue: (name) => name === 'kilnry-ghost',
    });
    expect(rules(resolved)).not.toContain('V8');
    const shipped = validateSkillFolder({
      frontmatter: fm,
      body: 'body',
      files: ['SKILL.md', 'workflows/kilnry-ghost.yaml'],
    });
    expect(rules(shipped)).not.toContain('V8');
  });

  it('V12 errors when a shipped workflow fails its own validator', () => {
    const issues = validateSkillFolder({
      frontmatter: baseFm,
      body: 'body',
      files: ['SKILL.md', 'workflows/broken.yaml'],
      readTextFile: () => 'id: broken',
      validateWorkflowYaml: () => ({ ok: false, firstError: 'no steps' }),
    });
    expect(rules(issues)).toContain('V12');
  });

  it('V13 warns on an unknown licence', () => {
    const issues = validateSkillFolder({
      frontmatter: { ...baseFm, license: 'Made-Up-1.0' },
      body: 'body',
      files: ['SKILL.md'],
    });
    const v13 = issues.find((issue) => issue.rule === 'V13');
    expect(v13?.level).toBe('warning');
  });

  it('V14 warns on a marketing-heavy description', () => {
    const fm = {
      ...baseFm,
      description:
        'A revolutionary, world-class skill that will supercharge your workflow. Use when you dare.',
    };
    const issues = validateSkillFolder({ frontmatter: fm, body: 'body', files: ['SKILL.md'] });
    const v14 = issues.find((issue) => issue.rule === 'V14');
    expect(v14?.level).toBe('warning');
  });
});

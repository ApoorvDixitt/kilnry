// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The shipped catalogue (F-SKL-02, F-WFL-07). Every bundled skill loads enabled
// and every catalogue workflow validates, so a missing frontmatter cue or an
// invalid YAML is caught here rather than at runtime.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { listSkills } from '@kilnry/core/skills/loader';
import { validateWorkflowFile } from '@kilnry/workflows';
import { bundledSkillsRoot } from './index.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const catalogueRoot = join(packageRoot, '..', 'workflows', 'catalogue');

const FLAGSHIP_SKILLS = ['kilnry-ugc-ad', 'kilnry-character-sheet', 'kilnry-faceless-video'];

const ALL_SKILLS = [
  'kilnry-ugc-ad',
  'kilnry-character-sheet',
  'kilnry-faceless-video',
  'kilnry-product-photoshoot',
  'kilnry-thumbnail',
  'kilnry-subtitles',
  'kilnry-narrator',
  'kilnry-motion-design',
  'kilnry-localize',
  'kilnry-ad-multiplier',
  'kilnry-brand-kit',
  'kilnry-video-edit',
  'kilnry-prompting',
  'kilnry-elements',
  'kilnry-storyboard',
  'kilnry-library-curation',
];

describe('shipped skills catalogue (F-SKL-02)', () => {
  it('loads every bundled skill enabled', async () => {
    const skills = await listSkills({ bundled: bundledSkillsRoot() });
    const names = new Set(skills.map((skill) => skill.name));
    for (const name of ALL_SKILLS) expect(names.has(name), `${name} is present`).toBe(true);
    expect(skills.length).toBe(ALL_SKILLS.length);
    for (const skill of skills) {
      expect(skill.enabled, `${skill.name}: ${skill.error ?? ''}`).toBe(true);
    }
  });

  it('ships the three flagship skills with a pipeline', async () => {
    const skills = await listSkills({ bundled: bundledSkillsRoot() });
    const byName = new Map(skills.map((skill) => [skill.name, skill]));
    for (const name of FLAGSHIP_SKILLS) {
      const skill = byName.get(name);
      expect(skill, `${name} is present`).toBeDefined();
      expect(skill?.has_pipeline).toBe(true);
    }
  });
});

describe('shipped workflow catalogue (F-WFL-07)', () => {
  it('validates every catalogue workflow', () => {
    const files = existsSync(catalogueRoot)
      ? readdirSync(catalogueRoot).filter((name) => name.endsWith('.yaml'))
      : [];
    expect(files.length).toBeGreaterThanOrEqual(9);
    for (const file of files) {
      const yaml = readFileSync(join(catalogueRoot, file), 'utf8');
      const result = validateWorkflowFile(yaml, file.replace(/\.yaml$/, ''));
      const errors = result.issues.filter((issue) => issue.level === 'error');
      expect(errors, `${file}: ${errors.map((issue) => issue.message).join('; ')}`).toEqual([]);
    }
  });
});

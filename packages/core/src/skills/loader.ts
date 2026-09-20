// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The Skill loader (F-SKL-01, TRD-13 §4). It reads every skill folder under the
// bundled and installed roots, parses and validates each SKILL.md, and exposes
// three reads that back the kilnry_skills tool: list (a short entry per skill),
// load (one skill's full body and file list), and load_file (a Markdown or JSON
// file referenced inside a skill). An installed skill shadows a bundled one of
// the same name. A skill with a validation error is listed as disabled with its
// first error rather than loaded. Every file read is contained inside the skill
// folder — no `..`, no absolute escape — so a skill can never read the disk
// outside itself.

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { parseSkillFrontmatter, SkillFrontmatterSchema } from './frontmatter.js';
import { validateSkill, type SkillIssue } from './validate.js';

export interface SkillListEntry {
  name: string;
  description: string;
  license: string;
  tags: string[];
  has_pipeline: boolean;
  files: string[];
  source: 'bundled' | 'installed';
  enabled: boolean;
  error?: string;
}

export interface SkillDetail {
  name: string;
  frontmatter: Record<string, unknown>;
  body_markdown: string;
  files: string[];
}

async function listDirs(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => join(root, entry.name));
  } catch {
    return [];
  }
}

// Every relative file inside a skill folder, for the list/load file manifest.
async function skillFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(current: string): Promise<void> {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, String(entry.name));
      if (entry.isDirectory()) await walk(full);
      else out.push(relative(dir, full));
    }
  }
  await walk(dir);
  return out.sort();
}

interface LoadedSkill {
  entry: SkillListEntry;
  dir: string;
  body: string;
  frontmatter: Record<string, unknown>;
  issues: SkillIssue[];
}

async function loadOne(dir: string, source: 'bundled' | 'installed'): Promise<LoadedSkill | null> {
  const dirName = dir.split('/').pop() ?? dir;
  let source_md: string;
  try {
    source_md = await readFile(join(dir, 'SKILL.md'), 'utf8');
  } catch {
    return null;
  }
  const frontmatter = parseSkillFrontmatter(source_md);
  const bodySplit = source_md.replace(/^---[\s\S]*?\n---\n?/, '');
  const issues = validateSkill({ dirName, frontmatter, body: bodySplit });
  const parsed = frontmatter ? SkillFrontmatterSchema.safeParse(frontmatter) : undefined;
  const files = await skillFiles(dir);
  const firstError = issues.find((issue) => issue.level === 'error');
  const entry: SkillListEntry = {
    name: parsed?.success ? parsed.data.name : dirName,
    description: parsed?.success ? parsed.data.description : '',
    license: parsed?.success ? (parsed.data.license ?? 'unknown') : 'unknown',
    tags: parsed?.success ? (parsed.data.metadata?.kilnry?.tags ?? []) : [],
    has_pipeline: Boolean(parsed?.success && parsed.data.metadata?.kilnry?.pipeline),
    files,
    source,
    enabled: !firstError,
    ...(firstError ? { error: firstError.message } : {}),
  };
  return { entry, dir, body: bodySplit, frontmatter: frontmatter ?? {}, issues };
}

// Load every skill under the given roots. Later roots shadow earlier ones by
// name, so an installed skill overrides a bundled skill with the same name.
export async function loadSkills(roots: {
  bundled: string;
  installed?: string;
}): Promise<Map<string, LoadedSkill>> {
  const byName = new Map<string, LoadedSkill>();
  for (const [source, root] of [
    ['bundled', roots.bundled],
    ['installed', roots.installed],
  ] as const) {
    if (!root) continue;
    for (const dir of await listDirs(root)) {
      const loaded = await loadOne(dir, source);
      if (loaded) byName.set(loaded.entry.name, loaded);
    }
  }
  return byName;
}

// The three reads the kilnry_skills tool performs.
export async function listSkills(roots: { bundled: string; installed?: string }): Promise<SkillListEntry[]> {
  const skills = await loadSkills(roots);
  return [...skills.values()].map((skill) => skill.entry).sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadSkill(
  roots: { bundled: string; installed?: string },
  name: string,
): Promise<SkillDetail | null> {
  const skills = await loadSkills(roots);
  const skill = skills.get(name);
  if (!skill || !skill.entry.enabled) return null;
  return {
    name: skill.entry.name,
    frontmatter: skill.frontmatter,
    body_markdown: skill.body,
    files: skill.entry.files,
  };
}

export async function loadSkillFile(
  roots: { bundled: string; installed?: string },
  name: string,
  relativePath: string,
): Promise<{ path: string; content: string } | null> {
  const skills = await loadSkills(roots);
  const skill = skills.get(name);
  if (!skill) return null;
  // Contain the read inside the skill folder: resolve and require the result to
  // start with the folder path, rejecting `..` and absolute escapes.
  const target = resolve(skill.dir, relativePath);
  const base = resolve(skill.dir);
  if (target !== base && !target.startsWith(`${base}/`)) return null;
  try {
    const stats = await stat(target);
    if (!stats.isFile()) return null;
    const content = await readFile(target, 'utf8');
    return { path: relativePath, content };
  } catch {
    return null;
  }
}

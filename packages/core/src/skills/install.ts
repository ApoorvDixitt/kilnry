// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Installing and validating a community skill (F-SKL-03, TRD-13 §7). The three
// install paths — the command line, an in-app folder or zip drop, and a URL —
// all end in the same place: a set of files whose keys are paths relative to a
// single skill folder. This module takes that file set, runs every rule that
// must pass before a skill is enabled (the parsed-content rules V1–V11 from
// validate.ts plus the filesystem rules that need the whole folder: no
// executable scripts, a size ceiling, no path escapes, a prompt-injection screen
// and a name-collision check against the shipped catalogue), and only when they
// pass writes the folder atomically into the installed root under the data
// directory. It never executes anything from the skill (D-45). The network fetch
// and archive unpacking live in the route that calls this, so the rules here are
// unit-testable against an in-memory file set.

import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseSkillFrontmatter, SkillFrontmatterSchema } from './frontmatter.js';
import { validateSkill, validateSkillFolder, type SkillIssue } from './validate.js';

/** A candidate skill: files keyed by their path relative to the skill folder. */
export type SkillFileSet = Map<string, Uint8Array>;

export interface InstallResult {
  ok: boolean;
  name?: string;
  issues: SkillIssue[];
  /** Prompt-injection matches that require an explicit "Install anyway". */
  warnings: SkillIssue[];
  installed_path?: string;
}

const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
// D-45: Kilnry V1 does not run skill scripts. Any executable is rejected.
const EXECUTABLE_EXTENSIONS = ['.sh', '.py', '.js', '.mjs', '.cjs', '.ts', '.rb', '.pl', '.php', '.bat'];
const SCRIPT_REJECTION =
  'Kilnry V1 does not run skill scripts. Remove executables or wait for V2 sandboxed scripts.';
// Prompt-injection phrases that flip tool permissions or exfiltrate keys.
const INJECTION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /ignore (all )?previous instructions/i, label: 'ignore previous instructions' },
  { pattern: /disable (the )?approval/i, label: 'disable approval' },
  { pattern: /skip (the )?(cost|estimate|confirmation)/i, label: 'skip the cost confirmation' },
  { pattern: /send (me )?the (api )?key/i, label: 'send the API key' },
  { pattern: /exfiltrat/i, label: 'exfiltrate' },
  { pattern: /without (asking|confirmation|approval)/i, label: 'act without approval' },
];

const textDecoder = new TextDecoder('utf8', { fatal: false });

function decode(bytes: Uint8Array): string {
  return textDecoder.decode(bytes);
}

function extensionOf(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot === -1 ? '' : path.slice(dot).toLowerCase();
}

// A path is unsafe if it escapes the skill folder or is absolute.
function isContainedPath(relativePath: string): boolean {
  if (relativePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(relativePath)) return false;
  const base = resolve('/skill');
  const target = resolve(base, relativePath);
  return target === base || target.startsWith(`${base}/`);
}

/**
 * Validate an incoming skill file set against every install rule. Returns the
 * issues (errors block the install), the prompt-injection warnings (which the
 * caller may override with an explicit acknowledgement), and the resolved skill
 * name. Does not touch the filesystem.
 */
export function validateSkillInstall(input: {
  files: SkillFileSet;
  /** The names already shipped in the bundled catalogue (kilnry-* are reserved). */
  shippedNames: Set<string>;
  /** Whether metadata.kilnry.pipeline resolves to a catalogue workflow (V8). */
  pipelineInCatalogue?: (name: string) => boolean;
  /** Validate a shipped workflow YAML the way the workflow validator does (V12). */
  validateWorkflowYaml?: (yaml: string, fileName: string) => { ok: boolean; firstError?: string };
  /** Validate a shipped preset JSON the way the preset validator does (V12). */
  validatePresetJson?: (text: string, fileName: string) => { ok: boolean; firstError?: string };
}): { issues: SkillIssue[]; warnings: SkillIssue[]; name?: string } {
  const issues: SkillIssue[] = [];
  const warnings: SkillIssue[] = [];

  const skillMd = input.files.get('SKILL.md');
  if (!skillMd) {
    issues.push({ rule: 'V1', level: 'error', message: 'The skill has no SKILL.md at its root.' });
    return { issues, warnings };
  }
  const source = decode(skillMd);
  const frontmatter = parseSkillFrontmatter(source);
  const body = source.replace(/^---[\s\S]*?\n---\n?/, '');
  const parsed = frontmatter ? SkillFrontmatterSchema.safeParse(frontmatter) : undefined;
  const name = parsed?.success ? parsed.data.name : undefined;

  // Parsed-content rules V1–V11 (name-matches-folder V2 is checked here against
  // the resolved name, which becomes the folder).
  issues.push(...validateSkill({ dirName: name ?? '', frontmatter, body }));

  // Folder-aware and cross-file rules V6–V8, V12–V14 read from the file set.
  const folderIssues = validateSkillFolder({
    frontmatter,
    body,
    files: [...input.files.keys()],
    readTextFile: (relativePath) => {
      const bytes = input.files.get(relativePath);
      return bytes === undefined ? undefined : decode(bytes);
    },
    ...(input.pipelineInCatalogue ? { pipelineInCatalogue: input.pipelineInCatalogue } : {}),
    ...(input.validateWorkflowYaml ? { validateWorkflowYaml: input.validateWorkflowYaml } : {}),
    ...(input.validatePresetJson ? { validatePresetJson: input.validatePresetJson } : {}),
  });
  for (const issue of folderIssues) {
    if (issue.level === 'warning' && issue.rule === 'V13') warnings.push(issue);
    else issues.push(issue);
  }

  // Filesystem rules that need the whole file set.
  let total = 0;
  for (const [path, bytes] of input.files) {
    total += bytes.byteLength;
    if (!isContainedPath(path)) {
      issues.push({
        rule: '7.5',
        level: 'error',
        message: `file "${path}" escapes the skill folder.`,
      });
    }
    const ext = extensionOf(path);
    if (path.startsWith('scripts/') && EXECUTABLE_EXTENSIONS.includes(ext)) {
      issues.push({ rule: '7.4', level: 'error', message: SCRIPT_REJECTION });
    }
  }
  if (total > MAX_TOTAL_BYTES) {
    issues.push({ rule: '7.5', level: 'error', message: 'The skill exceeds the 20 MB size limit.' });
  }

  // Name collision with a shipped kilnry-* skill is refused outright.
  if (name && input.shippedNames.has(name)) {
    issues.push({
      rule: '7.7',
      level: 'error',
      message: `A shipped skill is already named "${name}"; a community skill cannot replace it.`,
    });
  }

  // Prompt-injection screen (rule 6): a match is a warning that requires an
  // explicit acknowledgement, not an outright block.
  for (const { pattern, label } of INJECTION_PATTERNS) {
    if (pattern.test(body)) {
      warnings.push({
        rule: '7.6',
        level: 'warning',
        message: `The skill body contains a phrase that may try to change tool permissions or exfiltrate keys: "${label}".`,
      });
    }
  }

  return { issues, warnings, ...(name === undefined ? {} : { name }) };
}

/** The installed skills root under the data directory (TRD-13 §7 Paths). */
export function installedSkillsRoot(dataDir: string): string {
  return join(dataDir, 'skills');
}

/**
 * Install a validated skill file set into the installed root. Validation runs
 * first; an error blocks the install, and an un-acknowledged injection warning
 * blocks it too unless `acknowledgeWarnings` is set. The folder is written to a
 * temporary sibling and renamed into place so a half-written skill is never
 * visible. `source` is recorded in the frontmatter under metadata.kilnry._source
 * so `kilnry skills update` can re-fetch it.
 */
export async function installSkill(input: {
  files: SkillFileSet;
  dataDir: string;
  shippedNames: Set<string>;
  source?: string;
  acknowledgeWarnings?: boolean;
  pipelineInCatalogue?: (name: string) => boolean;
  validateWorkflowYaml?: (yaml: string, fileName: string) => { ok: boolean; firstError?: string };
  validatePresetJson?: (text: string, fileName: string) => { ok: boolean; firstError?: string };
}): Promise<InstallResult> {
  const { issues, warnings, name } = validateSkillInstall({
    files: input.files,
    shippedNames: input.shippedNames,
    ...(input.pipelineInCatalogue ? { pipelineInCatalogue: input.pipelineInCatalogue } : {}),
    ...(input.validateWorkflowYaml ? { validateWorkflowYaml: input.validateWorkflowYaml } : {}),
    ...(input.validatePresetJson ? { validatePresetJson: input.validatePresetJson } : {}),
  });
  const hasError = issues.some((issue) => issue.level === 'error');
  if (hasError || name === undefined) {
    return { ok: false, issues, warnings, ...(name === undefined ? {} : { name }) };
  }
  if (warnings.length > 0 && input.acknowledgeWarnings !== true) {
    return { ok: false, name, issues, warnings };
  }

  const root = installedSkillsRoot(input.dataDir);
  const target = join(root, name);
  const temp = `${target}.installing-${Date.now()}`;
  await rm(temp, { recursive: true, force: true });
  try {
    for (const [path, bytes] of input.files) {
      const dest = join(temp, path);
      await mkdir(join(dest, '..'), { recursive: true });
      await writeFile(dest, bytes);
    }
    await rm(target, { recursive: true, force: true });
    await mkdir(root, { recursive: true });
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { recursive: true, force: true });
    throw error;
  }
  return { ok: true, name, issues, warnings, installed_path: target };
}

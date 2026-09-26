// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The Skill validator (F-SKL-01, TRD-13 §4). It checks a parsed SKILL.md against
// the rules that keep a skill safe to load into an agent: the frontmatter shape
// (V1), the name-matches-folder rule (V2), a description that says what and when
// (V3), no angle brackets anywhere in frontmatter (V4), size limits (V5), that
// declared capabilities are real (V9), that the body carries no provider prompt
// tokens or raw keys (V10), and that it does not tell the agent to skip the cost
// confirmation (V11, a warning). Path-existence (V6), scripts (V7) and pipeline
// (V8) rules that need the filesystem are checked by the loader when it has the
// folder in hand; this function covers what is checkable from the parsed content.

import { CapabilitySchema } from '../types.js';
import { SkillFrontmatterSchema } from './frontmatter.js';
import { DeclarativePipelineSchema } from './pipeline.js';

export interface SkillIssue {
  rule: string;
  level: 'error' | 'warning';
  message: string;
}

const BODY_MAX_BYTES = 32 * 1024;
// Provider prompt tokens and raw key shapes that must never appear in a skill.
const PROMPT_TOKENS = [/@Element\d+/, /<<</, />>>/];
const KEY_SHAPES = [
  /sk-or-v1-[0-9a-f]{64}/,
  /sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/,
  /AIza[0-9A-Za-z_-]{35}/,
  /r8_[A-Za-z0-9]{37,40}/,
];
const SKIP_CONFIRM = [/without asking/i, /skip the estimate/i, /skip the cost/i];

function hasAngleBrackets(value: unknown): boolean {
  if (typeof value === 'string') return /[<>]/.test(value);
  if (Array.isArray(value)) return value.some(hasAngleBrackets);
  if (value && typeof value === 'object') return Object.values(value).some(hasAngleBrackets);
  return false;
}

const WHEN_CUES = ['use when', 'use for', 'when the user', 'trigger'];

// Validate a skill's frontmatter object, body and folder name. Returns every
// issue found; the loader disables a skill that has any error.
export function validateSkill(input: {
  dirName: string;
  frontmatter: Record<string, unknown> | null;
  body: string;
}): SkillIssue[] {
  const issues: SkillIssue[] = [];
  if (!input.frontmatter) {
    issues.push({ rule: 'V1', level: 'error', message: 'SKILL.md frontmatter is missing or unparseable.' });
    return issues;
  }
  const parsed = SkillFrontmatterSchema.safeParse(input.frontmatter);
  if (!parsed.success) {
    issues.push({
      rule: 'V1',
      level: 'error',
      message: `Frontmatter does not match the skill schema: ${parsed.error.issues[0]?.message ?? 'invalid'}.`,
    });
    return issues;
  }
  const fm = parsed.data;

  if (fm.name !== input.dirName)
    issues.push({
      rule: 'V2',
      level: 'error',
      message: `name "${fm.name}" must equal the folder name "${input.dirName}".`,
    });

  if (!WHEN_CUES.some((cue) => fm.description.toLowerCase().includes(cue)))
    issues.push({
      rule: 'V3',
      level: 'warning',
      message: 'description should say when to use the skill (e.g. "use when…").',
    });

  if (hasAngleBrackets(input.frontmatter))
    issues.push({ rule: 'V4', level: 'error', message: 'frontmatter must not contain < or >.' });

  if (Buffer.byteLength(input.body, 'utf8') > BODY_MAX_BYTES)
    issues.push({ rule: 'V5', level: 'error', message: 'SKILL.md body exceeds 32 KB.' });

  const caps = fm.metadata?.kilnry?.requires_capabilities ?? [];
  for (const capability of caps) {
    if (!CapabilitySchema.safeParse(capability).success)
      issues.push({
        rule: 'V9',
        level: 'error',
        message: `requires_capabilities has an unknown capability "${String(capability)}".`,
      });
  }

  if (PROMPT_TOKENS.some((pattern) => pattern.test(input.body)))
    issues.push({
      rule: 'V10',
      level: 'error',
      message: 'body must not contain provider prompt tokens (@Element1, <<<, >>>).',
    });
  if (KEY_SHAPES.some((pattern) => pattern.test(input.body)))
    issues.push({ rule: 'V10', level: 'error', message: 'body must not contain a raw provider key.' });

  if (SKIP_CONFIRM.some((pattern) => pattern.test(input.body)))
    issues.push({
      rule: 'V11',
      level: 'warning',
      message: 'body appears to tell the agent to skip cost confirmation.',
    });

  return issues;
}

// The SPDX identifiers a shipped or community skill may declare, plus Kilnry's
// own licence id. V13 warns on anything else so a licence typo is visible.
const KNOWN_LICENSES = new Set([
  'Sustainable-Use-1.0',
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'MPL-2.0',
  'GPL-3.0',
  'GPL-3.0-only',
  'GPL-3.0-or-later',
  'LGPL-3.0',
  'AGPL-3.0',
  'CC0-1.0',
  'CC-BY-4.0',
  'CC-BY-SA-4.0',
  'Unlicense',
]);

const MARKETING_WORDS = [
  'revolutionary',
  'cutting-edge',
  'state-of-the-art',
  'world-class',
  'best-in-class',
  'game-changer',
  'game changing',
  'next-generation',
  'unleash',
  'supercharge',
];

const REFERENCE_PATH = /`((?:references|scripts|assets)\/[^`]+)`/g;
const NON_HTTPS_URL = /`((?:http:\/\/|ftp:\/\/|file:\/\/)[^`]+)`/g;

// The filesystem-aware and cross-file rules from TRD-13 §4 that the parsed-body
// validateSkill cannot check on its own: V6 (referenced paths exist inside the
// folder, no escape, no non-https URL), V7 (scripts/ holds only declarative JSON
// pipelines, D-45), V8 (the linked workflow resolves), V12 (bundled presets and
// workflows validate), V13 (licence is a known SPDX id or Kilnry's), V14
// (description lint). Each input is optional so a caller that cannot supply a
// piece (for instance, a validator injected from another package) simply skips
// that rule; the loader and the installer pass what they have.
export interface SkillFolderInput {
  frontmatter: Record<string, unknown> | null;
  body: string;
  /** Every file path relative to the skill folder. */
  files: string[];
  /** Read a text file inside the folder (for V7 pipeline parsing, V12 assets). */
  readTextFile?: (relativePath: string) => string | undefined;
  /** Whether metadata.kilnry.pipeline resolves to a catalogue workflow (V8). */
  pipelineInCatalogue?: (name: string) => boolean;
  /** Validate a shipped workflow YAML the way the workflow validator does (V12). */
  validateWorkflowYaml?: (yaml: string, fileName: string) => { ok: boolean; firstError?: string };
  /** Validate a shipped preset JSON the way the preset validator does (V12). */
  validatePresetJson?: (text: string, fileName: string) => { ok: boolean; firstError?: string };
}

export function validateSkillFolder(input: SkillFolderInput): SkillIssue[] {
  const issues: SkillIssue[] = [];
  const fileSet = new Set(input.files);
  const has = (relativePath: string): boolean => fileSet.has(relativePath);

  // V6 — every references/, scripts/, assets/ path named in the body exists in
  // the folder; no `..`, no absolute path, no non-https URL.
  for (const match of input.body.matchAll(REFERENCE_PATH)) {
    const relativePath = match[1]!;
    if (relativePath.includes('..') || relativePath.startsWith('/')) {
      issues.push({
        rule: 'V6',
        level: 'error',
        message: `body references an unsafe path "${relativePath}" (no .. or absolute paths).`,
      });
    } else if (relativePath.includes('*')) {
      // A glob (e.g. references/looks/*.md) is satisfied when at least one file
      // in the folder matches it.
      const pattern = new RegExp(
        `^${relativePath.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`,
      );
      if (!input.files.some((file) => pattern.test(file))) {
        issues.push({
          rule: 'V6',
          level: 'error',
          message: `body references "${relativePath}", but no file in the skill folder matches it.`,
        });
      }
    } else if (!has(relativePath)) {
      issues.push({
        rule: 'V6',
        level: 'error',
        message: `body references "${relativePath}", which is not in the skill folder.`,
      });
    }
  }
  for (const match of input.body.matchAll(NON_HTTPS_URL)) {
    issues.push({
      rule: 'V6',
      level: 'error',
      message: `body links a non-https resource "${match[1]}"; only https URLs are allowed.`,
    });
  }

  // V7 — scripts/ holds only *.json validating against DeclarativePipeline; any
  // other file type there is an error (D-45).
  for (const path of input.files) {
    if (!path.startsWith('scripts/')) continue;
    if (!path.endsWith('.json')) {
      issues.push({
        rule: 'V7',
        level: 'error',
        message: `scripts/ may hold only declarative JSON pipelines; "${path}" is not JSON (D-45, no code execution).`,
      });
      continue;
    }
    const text = input.readTextFile?.(path);
    if (text === undefined) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      issues.push({ rule: 'V7', level: 'error', message: `scripts file "${path}" is not valid JSON.` });
      continue;
    }
    const result = DeclarativePipelineSchema.safeParse(parsed);
    if (!result.success) {
      issues.push({
        rule: 'V7',
        level: 'error',
        message: `scripts file "${path}" is not a valid declarative pipeline: ${result.error.issues[0]?.message ?? 'invalid'}.`,
      });
    }
  }

  const parsed = input.frontmatter ? SkillFrontmatterSchema.safeParse(input.frontmatter) : undefined;
  const fm = parsed?.success ? parsed.data : undefined;

  // V8 — metadata.kilnry.pipeline resolves to a catalogue workflow or a shipped
  // ./workflows/<pipeline>.yaml.
  const pipeline = fm?.metadata?.kilnry?.pipeline;
  if (typeof pipeline === 'string' && pipeline !== '') {
    const shippedWorkflow = has(`workflows/${pipeline}.yaml`) || has(`workflows/${pipeline}.yml`);
    const inCatalogue = input.pipelineInCatalogue?.(pipeline) ?? false;
    if (!shippedWorkflow && !inCatalogue) {
      issues.push({
        rule: 'V8',
        level: 'error',
        message: `metadata.kilnry.pipeline "${pipeline}" does not resolve to a catalogue workflow or ./workflows/.`,
      });
    }
  }

  // V12 — shipped presets/*.json and workflows/*.yaml pass their own validators.
  for (const path of input.files) {
    if (path.startsWith('workflows/') && (path.endsWith('.yaml') || path.endsWith('.yml'))) {
      const yaml = input.readTextFile?.(path);
      if (yaml !== undefined && input.validateWorkflowYaml) {
        const result = input.validateWorkflowYaml(yaml, path);
        if (!result.ok)
          issues.push({
            rule: 'V12',
            level: 'error',
            message: `shipped workflow "${path}" fails validation: ${result.firstError ?? 'invalid'}.`,
          });
      }
    } else if (path.startsWith('presets/') && path.endsWith('.json')) {
      const text = input.readTextFile?.(path);
      if (text !== undefined && input.validatePresetJson) {
        const result = input.validatePresetJson(text, path);
        if (!result.ok)
          issues.push({
            rule: 'V12',
            level: 'error',
            message: `shipped preset "${path}" fails validation: ${result.firstError ?? 'invalid'}.`,
          });
      }
    }
  }

  // V13 — licence is a known SPDX id or Kilnry's Sustainable-Use-1.0 (warning).
  if (fm?.license !== undefined && !KNOWN_LICENSES.has(fm.license)) {
    issues.push({
      rule: 'V13',
      level: 'warning',
      message: `license "${fm.license}" is not a recognised SPDX identifier or Sustainable-Use-1.0.`,
    });
  }

  // V14 — description lint (warning): not a bare restatement of the name, at most
  // three sentences, no marketing-adjective pile-up.
  if (fm) {
    const description = fm.description;
    const sentences = description.split(/[.!?]+/).filter((part) => part.trim() !== '');
    if (sentences.length > 3)
      issues.push({
        rule: 'V14',
        level: 'warning',
        message: 'description should be at most three sentences.',
      });
    if (description.trim().toLowerCase().replace(/[-_]/g, ' ') === fm.name.replace(/[-_]/g, ' '))
      issues.push({
        rule: 'V14',
        level: 'warning',
        message: 'description should say more than the skill name.',
      });
    const lower = description.toLowerCase();
    if (MARKETING_WORDS.filter((word) => lower.includes(word)).length >= 2)
      issues.push({
        rule: 'V14',
        level: 'warning',
        message: 'description reads like marketing copy; describe what it does and when to use it.',
      });
  }

  return issues;
}

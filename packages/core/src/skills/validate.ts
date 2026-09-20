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

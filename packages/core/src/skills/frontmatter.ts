// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The Skill format (F-SKL-01, TRD-13 §2). A Skill is a folder with a SKILL.md
// whose frontmatter follows the Agent Skills specification plus a Kilnry block
// under metadata.kilnry. This module defines the frontmatter schema and parses
// the frontmatter block with the pinned `yaml` package (a full YAML-1.2 parser),
// replacing the earlier hand-rolled reader (M5 default revisited in M6): the
// same real parser now backs both this format and the Workflow YAML DSL
// (TRD-12 §1), so scalars, folded and literal blocks, nested maps and inline or
// block arrays are all understood. Fail-closed behaviour is unchanged: a block
// that does not parse, or that does not parse to a plain object, returns null so
// the validator reports it (V1).

import { parse as parseYaml } from 'yaml';
import * as z from 'zod';
import { CapabilitySchema } from '../types.js';

const Id = z.string().min(1);

export const SkillFrontmatterSchema = z
  .object({
    name: z
      .string()
      .max(64)
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    description: z
      .string()
      .min(20)
      .max(1024)
      .refine((value) => !/[<>]/.test(value), 'no angle brackets in frontmatter'),
    license: z.string().max(64).optional(),
    compatibility: z.string().max(500).optional(),
    'allowed-tools': z.string().max(500).optional(),
    metadata: z
      .object({
        author: z.string().optional(),
        version: z.string().optional(),
        kilnry: z
          .object({
            pipeline: Id.optional(),
            requires_capabilities: z.array(CapabilitySchema).default([]),
            cost_hint: z.string().max(120).optional(),
            version: z.string().regex(/^\d+\.\d+\.\d+$/),
            tags: z.array(z.string().max(24)).max(10).default([]),
            triggers: z.array(z.string().max(40)).max(12).default([]),
            presets: z.array(Id).default([]),
            min_kilnry: z.string().optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

// Split a SKILL.md into its frontmatter block and body. Frontmatter is delimited
// by a leading `---` line and a closing `---` line, per the Agent Skills spec.
export function splitFrontmatter(source: string): { frontmatter: string; body: string } | null {
  const normalised = source.replace(/^\uFEFF/, '');
  if (!normalised.startsWith('---')) return null;
  const end = normalised.indexOf('\n---', 3);
  if (end === -1) return null;
  const frontmatter = normalised.slice(normalised.indexOf('\n') + 1, end);
  const afterClose = normalised.indexOf('\n', end + 1);
  const body = afterClose === -1 ? '' : normalised.slice(afterClose + 1);
  return { frontmatter, body };
}

// Parse the frontmatter block with the pinned YAML-1.2 parser. Returns a plain
// object, or null when the block is missing, does not parse, or does not parse
// to a mapping — the same fail-closed contract the hand-rolled reader had, so
// the validator still reports an unparseable block as a V1 error.
export function parseSkillFrontmatter(source: string): Record<string, unknown> | null {
  const split = splitFrontmatter(source);
  if (!split) return null;
  let parsed: unknown;
  try {
    // uniqueKeys guards against a duplicated frontmatter key; the default merge
    // and anchor handling stay off-limits because the value must be plain data.
    parsed = parseYaml(split.frontmatter, { uniqueKeys: true });
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The Skill format (F-SKL-01, TRD-13 §2). A Skill is a folder with a SKILL.md
// whose frontmatter follows the Agent Skills specification plus a Kilnry block
// under metadata.kilnry. This module defines the frontmatter schema and a small
// parser for the constrained YAML-1.2 block the format allows: scalars, one
// level of nested maps (metadata, metadata.kilnry) and simple inline or block
// arrays. The format forbids angle brackets in frontmatter values, so the parser
// does not need to handle YAML flow-mapping or anchors; anything it cannot parse
// fails closed and the validator reports it.

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

// Parse one YAML scalar value: strip surrounding single/double quotes, keep the
// rest verbatim. Numbers stay strings; the schema coerces where needed.
function scalar(raw: string): string {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

// Parse an inline array like `[a, b, c]` or `["a", "b"]`.
function inlineArray(raw: string): string[] {
  const inner = raw.trim().slice(1, -1).trim();
  if (inner.length === 0) return [];
  return inner.split(',').map((entry) => scalar(entry));
}

// Parse the constrained frontmatter block into a plain object. Handles scalars,
// folded scalars (`>`), two levels of indented maps, inline arrays and block
// (`- item`) arrays. Returns null when a line cannot be understood.
export function parseSkillFrontmatter(source: string): Record<string, unknown> | null {
  const split = splitFrontmatter(source);
  if (!split) return null;
  const lines = split.frontmatter.split('\n');
  const root: Record<string, unknown> = {};
  // A stack of (indent, container) so nested maps attach to the right parent.
  const stack: Array<{ indent: number; map: Record<string, unknown> }> = [{ indent: -1, map: root }];
  let pendingArray: { key: string; map: Record<string, unknown>; items: string[] } | null = null;
  let folded: { key: string; map: Record<string, unknown>; parts: string[]; indent: number } | null = null;

  const flushArray = (): void => {
    if (pendingArray) {
      if (pendingArray.items.length > 0) pendingArray.map[pendingArray.key] = pendingArray.items;
      pendingArray = null;
    }
  };
  const flushFolded = (): void => {
    if (folded) {
      folded.map[folded.key] = folded.parts.join(' ').trim();
      folded = null;
    }
  };

  for (const rawLine of lines) {
    if (rawLine.trim().length === 0 || rawLine.trim().startsWith('#')) continue;
    const indent = rawLine.length - rawLine.trimStart().length;
    const line = rawLine.trim();

    if (folded && indent > folded.indent) {
      folded.parts.push(line);
      continue;
    }
    flushFolded();

    if (line.startsWith('- ')) {
      if (!pendingArray) return null;
      pendingArray.items.push(scalar(line.slice(2)));
      continue;
    }
    flushArray();

    const colon = line.indexOf(':');
    if (colon === -1) return null;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();

    while (stack.length > 1 && indent <= stack[stack.length - 1]!.indent) stack.pop();
    const parent = stack[stack.length - 1]!.map;

    if (value === '') {
      // Either a nested map or the header of a block array; decide on next line.
      const child: Record<string, unknown> = {};
      parent[key] = child;
      stack.push({ indent, map: child });
      pendingArray = { key, map: parent, items: [] };
      // If the next non-empty line is a `- ` item, flushArray writes the array
      // over the empty child; otherwise the child map stays.
      continue;
    }
    if (value === '>' || value === '|') {
      folded = { key, map: parent, parts: [], indent };
      continue;
    }
    if (value.startsWith('[') && value.endsWith(']')) {
      parent[key] = inlineArray(value);
      continue;
    }
    parent[key] = scalar(value);
  }
  flushArray();
  flushFolded();
  return root;
}

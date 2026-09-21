// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Checking a preset before it is trusted (F-PRE-03, TRD-12 §12). Every shipped
// preset is validated in the build, and an imported one is validated before it is
// registered, so a broken file is reported with the field that is wrong rather
// than failing later in front of a paying request.
//
// An error means the preset cannot run. A warning means it will run but something
// is worth saying: a model nobody has a key for, or a licence that is not a
// recognised identifier.

import { MAX_PRESET_BYTES, PresetJsonSchema, PROVIDER_PROMPT_TOKENS, type PresetJson } from './schema.js';

export interface PresetIssue {
  level: 'error' | 'warning';
  /** The rule number from TRD-12 §12, for the message shown in Settings. */
  rule: string;
  message: string;
}

export interface ValidatePresetInput {
  /** The parsed file. Pass the raw text as well to check the size and the parse. */
  value: unknown;
  /** The file name without its extension, which must equal the preset id. */
  fileName?: string;
  /** The raw bytes, when the preset came from a file. */
  bytes?: number;
  /** Providers that currently have a key, for the not-connected warning. */
  connected?: string[];
}

/** Every placeholder a prompt or parameter names, in order of appearance. */
export function placeholders(text: string): string[] {
  const found: string[] = [];
  // {{ slot }} and the conditional form {{#if slot}} … {{/if}}
  const pattern = /\{\{\s*(?:#if\s+)?([a-z][a-z0-9_]*)\s*\}\}/g;
  for (const match of text.matchAll(pattern)) {
    const name = match[1];
    if (name !== undefined && !found.includes(name)) found.push(name);
  }
  return found;
}

/** Every placeholder used anywhere in the preset: the prompt and the parameters. */
export function usedPlaceholders(preset: PresetJson): string[] {
  const names = placeholders(preset.prompt);
  for (const value of Object.values(preset.params)) {
    if (typeof value !== 'string') continue;
    for (const name of placeholders(value)) if (!names.includes(name)) names.push(name);
  }
  if (preset.negative_prompt) {
    for (const name of placeholders(preset.negative_prompt)) if (!names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * Validate one preset. Returns the parsed preset when it can run, plus every
 * issue found. A file with any error is not registered.
 */
export function validatePreset(input: ValidatePresetInput): {
  preset?: PresetJson;
  issues: PresetIssue[];
} {
  const issues: PresetIssue[] = [];

  if (typeof input.bytes === 'number' && input.bytes > MAX_PRESET_BYTES) {
    issues.push({
      level: 'error',
      rule: 'P7',
      message: `The preset file is larger than ${MAX_PRESET_BYTES / 1024} KB.`,
    });
  }

  const parsed = PresetJsonSchema.safeParse(input.value);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const where = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
      issues.push({ level: 'error', rule: 'P1', message: `${where}${issue.message}` });
    }
    return { issues };
  }
  const preset = parsed.data;

  // P2 — the id names the file, so a preset can be found by either.
  if (input.fileName !== undefined && input.fileName !== preset.id) {
    issues.push({
      level: 'error',
      rule: 'P2',
      message: `The id "${preset.id}" does not match the file name "${input.fileName}".`,
    });
  }

  // P3 — every placeholder names a declared slot, so no form leaves a gap.
  const declared = new Set(preset.slots.map((slot) => slot.name));
  for (const name of usedPlaceholders(preset)) {
    if (!declared.has(name)) {
      issues.push({
        level: 'error',
        rule: 'P3',
        message: `The placeholder {{ ${name} }} does not name a declared slot.`,
      });
    }
  }

  // P4 — a media binding points at a slot that can actually hold one.
  for (const media of preset.medias) {
    const slot = preset.slots.find((entry) => entry.name === media.from_slot);
    if (!slot) {
      issues.push({
        level: 'error',
        rule: 'P4',
        message: `The media role "${media.role}" reads slot "${media.from_slot}", which is not declared.`,
      });
      continue;
    }
    if (slot.type !== 'media' && slot.type !== 'character') {
      issues.push({
        level: 'error',
        rule: 'P4',
        message: `The media role "${media.role}" reads slot "${slot.name}", which is a ${slot.type} slot.`,
      });
    }
  }

  // P5 — a required slot with no default must be asked for, not assumed.
  for (const slot of preset.slots) {
    if (slot.type === 'enum' && (slot.options === undefined || slot.options.length === 0)) {
      issues.push({
        level: 'error',
        rule: 'P5',
        message: `Slot "${slot.name}" is a choice with no options.`,
      });
    }
    if (slot.type === 'enum' && typeof slot.default === 'string' && slot.options) {
      if (!slot.options.includes(slot.default)) {
        issues.push({
          level: 'error',
          rule: 'P5',
          message: `Slot "${slot.name}" defaults to "${slot.default}", which is not one of its options.`,
        });
      }
    }
  }

  // P6 — a preset never hard-codes a provider's own prompt tokens (D-16).
  for (const token of PROVIDER_PROMPT_TOKENS) {
    if (preset.prompt.includes(token)) {
      issues.push({
        level: 'error',
        rule: 'P6',
        message: `The prompt contains the provider token "${token}"; use a slot and let the resolver inject it.`,
      });
    }
  }

  // P8 — a model nobody can reach still loads, with a badge saying why.
  if (preset.needs.length > 0 && input.connected) {
    const missing = preset.needs.filter((provider) => !input.connected?.includes(provider));
    if (missing.length === preset.needs.length) {
      issues.push({
        level: 'warning',
        rule: 'P8',
        message: `This preset needs a key for ${missing.join(' or ')}.`,
      });
    }
  }

  // P9 — a licence should be an identifier others can look up.
  if (!/^[A-Za-z0-9.+-]+$/.test(preset.license)) {
    issues.push({
      level: 'warning',
      rule: 'P9',
      message: `The licence "${preset.license}" is not a recognisable identifier.`,
    });
  }

  const hasError = issues.some((issue) => issue.level === 'error');
  return hasError ? { issues } : { preset, issues };
}

/** Parse a preset file's text and validate it in one step. */
export function validatePresetFile(
  text: string,
  fileName?: string,
  connected?: string[],
): { preset?: PresetJson; issues: PresetIssue[] } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return {
      issues: [
        {
          level: 'error',
          rule: 'P1',
          message: `The preset is not valid JSON: ${error instanceof Error ? error.message : 'parse failed'}.`,
        },
      ],
    };
  }
  return validatePreset({
    value,
    ...(fileName === undefined ? {} : { fileName }),
    bytes: Buffer.byteLength(text, 'utf8'),
    ...(connected === undefined ? {} : { connected }),
  });
}

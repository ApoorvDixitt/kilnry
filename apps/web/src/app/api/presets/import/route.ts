// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Import a preset (F-PRE-04). Two steps, deliberately: `preview` validates and
// reports what the file would add, writing nothing; `add` writes it into the
// user folder. Nothing is fetched until the user asks, and a pasted address is
// fetched through the guard that refuses private networks, so a link cannot be
// used to probe the machine Kilnry runs on.
//
// An imported preset then behaves exactly like a shipped one: the loader reads
// the same folder and the drawer prices it through the same estimator.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextResponse } from 'next/server';
import { KilnryError, loadConfig, safeFetch } from '@kilnry/core';
import { validatePresetFile, type PresetIssue } from '@kilnry/presets';
import * as z from 'zod';
import { errorResponse, requireSession } from '../../../../server/http';

const MAX_IMPORT_BYTES = 64 * 1024;

const ImportInput = z
  .object({
    action: z.enum(['preview', 'add']).default('preview'),
    json: z.string().max(MAX_IMPORT_BYTES).optional(),
    url: z.string().url().optional(),
    /** What to do when the identifier is already installed. */
    on_collision: z.enum(['ask', 'replace', 'keep_both']).default('ask'),
  })
  .refine((value) => value.json !== undefined || value.url !== undefined, {
    message: 'Give either the file contents or an address to fetch.',
  });

/** Where a user's own presets live. */
async function userRoot(): Promise<string> {
  const config = await loadConfig();
  return join(config.data_dir, 'presets');
}

/** The text to validate, fetched only when the caller asked for it. */
async function sourceText(input: { json?: string | undefined; url?: string | undefined }): Promise<string> {
  if (input.json !== undefined) return input.json;
  const url = input.url ?? '';
  if (!url.startsWith('https://')) {
    throw new KilnryError('INVALID_INPUT', 'A preset address must start with https://.');
  }
  const response = await safeFetch(url);
  if (!response.ok) {
    throw new KilnryError('NOT_FOUND', `That address answered ${response.status}.`);
  }
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_IMPORT_BYTES) {
    throw new KilnryError('INVALID_INPUT', 'A preset file must be 64 KB or smaller.');
  }
  return text;
}

/** Whether a file of this name already sits in the user folder. */
async function installed(root: string, id: string): Promise<boolean> {
  try {
    await readFile(join(root, `${id}.json`), 'utf8');
    return true;
  } catch {
    return false;
  }
}

/** The name to save under when the identifier is taken: id-2, id-3, and so on. */
async function freeName(root: string, id: string): Promise<string> {
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = `${id}-${suffix}`;
    if (!(await installed(root, candidate))) return candidate;
  }
  throw new KilnryError('INVALID_INPUT', 'Too many copies of that preset are already installed.');
}

/** The errors and warnings, as the dialog shows them. */
function report(issues: PresetIssue[]): {
  errors: PresetIssue[];
  warnings: PresetIssue[];
} {
  return {
    errors: issues.filter((issue) => issue.level === 'error'),
    warnings: issues.filter((issue) => issue.level !== 'error'),
  };
}

export async function POST(request: Request): Promise<Response> {
  try {
    await requireSession();
    const input = ImportInput.parse(await request.json());
    const text = await sourceText(input);
    const root = await userRoot();

    // The identifier a preset must be saved under is the one inside the file,
    // because the loader keys on the file name.
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return NextResponse.json({
        valid: false,
        errors: [{ level: 'error', rule: 'P1', message: 'That file is not valid JSON.' }],
        warnings: [],
      });
    }
    const declaredId =
      typeof parsed === 'object' && parsed !== null && typeof (parsed as { id?: unknown }).id === 'string'
        ? (parsed as { id: string }).id
        : '';
    const { preset, issues } = validatePresetFile(text, declaredId);
    const { errors, warnings } = report(issues);

    if (!preset || errors.length > 0) {
      return NextResponse.json({ valid: false, errors, warnings });
    }

    const collides = await installed(root, preset.id);

    if (input.action === 'preview') {
      return NextResponse.json({
        valid: true,
        errors: [],
        warnings,
        collides,
        preset: {
          id: preset.id,
          name: preset.name,
          category: preset.category,
          description: preset.description,
          kind: preset.kind,
          model: preset.model.id,
          indicative_cost_usd: preset.indicative_cost_usd,
          slots: preset.slots.map((slot) => ({
            name: slot.name,
            type: slot.type,
            label: slot.label,
            required: slot.required,
          })),
          prompt: preset.prompt,
          license: preset.license,
          author: preset.author,
        },
      });
    }

    if (collides && input.on_collision === 'ask') {
      throw new KilnryError(
        'CONFIRMATION_REQUIRED',
        `A preset called ${preset.id} is already installed. Replace it or keep both.`,
      );
    }
    const name = collides && input.on_collision === 'keep_both' ? await freeName(root, preset.id) : preset.id;

    await mkdir(root, { recursive: true });
    // The file is saved with the identifier it will be read under, so the name
    // and the identifier inside it always agree.
    const saved = { ...(parsed as Record<string, unknown>), id: name };
    await writeFile(join(root, `${name}.json`), `${JSON.stringify(saved, null, 2)}\n`, 'utf8');

    return NextResponse.json({
      valid: true,
      errors: [],
      warnings,
      added: name,
      replaced: collides && input.on_collision === 'replace',
      ...(input.url === undefined ? {} : { source: input.url }),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

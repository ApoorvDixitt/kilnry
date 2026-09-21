// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Save a preset of your own (F-CRE-12). The composer sends the file it built and
// this route checks it against the same schema every shipped preset passes
// before writing it, so a saved preset can never be one the catalogue cannot
// read. The drawer's "Save copy" comes through here too: a copy is just another
// preset written into the user folder.

import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextResponse } from 'next/server';
import { KilnryError, loadConfig } from '@kilnry/core';
import { validatePreset } from '@kilnry/presets';
import * as z from 'zod';
import { errorResponse, requireSession } from '../../../../server/http';
import { presetRoots, userPresetRoot } from '../../../../server/presets';

const SaveInput = z.object({
  preset: z.record(z.string(), z.unknown()),
  /** Whether a name already in use may be overwritten. */
  overwrite: z.boolean().default(false),
});

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    await requireSession();
    const input = SaveInput.parse(await request.json());
    const id = typeof input.preset.id === 'string' ? input.preset.id : '';
    if (id === '') throw new KilnryError('INVALID_INPUT', 'A preset needs an identifier.');

    // The same checks a shipped preset passes, so a saved file is never one the
    // catalogue would later refuse to read (PRD-05 §12 acceptance 1).
    const { preset, issues } = validatePreset({ value: input.preset, fileName: id });
    const errors = issues.filter((issue) => issue.level === 'error');
    if (!preset || errors.length > 0) {
      return NextResponse.json({ saved: false, errors }, { status: 200 });
    }

    const config = await loadConfig();
    const root = userPresetRoot(config.data_dir);
    const path = join(root, `${id}.json`);
    if (!input.overwrite && (await exists(path))) {
      return NextResponse.json({ saved: false, collides: true, id, errors: [] });
    }

    await mkdir(root, { recursive: true });
    await writeFile(path, `${JSON.stringify(input.preset, null, 2)}\n`, 'utf8');
    // Read the catalogue back so the reply proves the file is now visible.
    const roots = await presetRoots();
    return NextResponse.json({ saved: true, id, path, errors: [], roots_read: Object.keys(roots).length });
  } catch (error) {
    return errorResponse(error);
  }
}

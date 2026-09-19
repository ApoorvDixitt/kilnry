// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextResponse } from 'next/server';
import * as z from 'zod';
import { KilnryError, loadConfig, prepareLibraryRoot, saveConfig } from '@kilnry/core';
import { putSetting } from '@kilnry/db';
import { currentSession } from '../../../../server/session';
import { ensureRuntimeEngine } from '../../../../server/runtime';

const Input = z.object({ path: z.string().min(1).max(4096) });

export async function POST(request: Request): Promise<Response> {
  const session = await currentSession();
  if (!session)
    return NextResponse.json(
      { error: { code: 'INVALID_INPUT', message: 'authentication required' } },
      { status: 401 },
    );
  try {
    const input = Input.parse(await request.json());
    const config = loadConfig();
    const result = prepareLibraryRoot(input.path, config.data_dir);
    const updated = { ...config, library_root: result.root, onboarding_complete: false };
    saveConfig(updated);
    await putSetting('library_root', result.root, config.data_dir);
    await putSetting('library_id', result.marker.library_id, config.data_dir);
    await putSetting('onboarding_step', 3, config.data_dir);
    await ensureRuntimeEngine();
    return NextResponse.json({ ok: true, root: result.root, library_id: result.marker.library_id });
  } catch (error) {
    if (error instanceof KilnryError) return NextResponse.json({ error: error.toJSON() }, { status: 422 });
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: { code: 'INVALID_INPUT', message: 'Choose a valid Library folder.', details: error.issues },
        },
        { status: 422 },
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: { code: 'PROVIDER_ERROR', message: `Kilnry couldn't prepare the Library: ${message}` } },
      { status: 500 },
    );
  }
}

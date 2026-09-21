// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// One preset, for the use drawer (F-PRE-02). The drawer needs the whole file —
// slots in order, the model chip and its alternates, the parameters — which the
// catalogue list deliberately does not carry.

import { join } from 'node:path';
import { NextResponse } from 'next/server';
import { KilnryError, loadConfig } from '@kilnry/core';
import { getPreset } from '@kilnry/presets';
import { errorResponse, requireSession } from '../../../../server/http';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireSession();
    const { id } = await context.params;
    const config = await loadConfig();
    const entry = getPreset(id, { user: join(config.data_dir, 'presets') });
    if (!entry || !entry.preset) {
      throw new KilnryError('NOT_FOUND', `No preset called ${id} is installed.`);
    }
    return NextResponse.json({ preset: entry.preset, source: entry.source, path: entry.path });
  } catch (error) {
    return errorResponse(error);
  }
}

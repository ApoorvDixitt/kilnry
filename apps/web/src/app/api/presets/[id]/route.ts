// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// One preset, for the use drawer (F-PRE-02). The drawer needs the whole file —
// slots in order, the model chip and its alternates, the parameters — which the
// catalogue list deliberately does not carry.

import { NextResponse } from 'next/server';
import * as z from 'zod';
import { KilnryError } from '@kilnry/core';
import { getPreset } from '@kilnry/presets';
import { errorResponse, requireSession } from '../../../../server/http';
import { presetRoots, setPresetEnabled } from '../../../../server/presets';
import { runtimeServices } from '../../../../server/runtime';

const PatchInput = z.object({ enabled: z.boolean() });

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireSession();
    const { id } = await context.params;
    const entry = getPreset(id, await presetRoots());
    if (!entry || !entry.preset) {
      throw new KilnryError('NOT_FOUND', `No preset called ${id} is installed.`);
    }
    return NextResponse.json({ preset: entry.preset, source: entry.source, path: entry.path });
  } catch (error) {
    return errorResponse(error);
  }
}

// Enable or disable a preset (F-SET-06). A disabled preset is hidden from the
// catalogue grid and the kilnry_presets list; the state persists in settings.
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireSession();
    const { id } = await context.params;
    const body = PatchInput.parse(await request.json());
    const services = await runtimeServices();
    await setPresetEnabled(services.database, id, body.enabled);
    return NextResponse.json({ ok: true, id, enabled: body.enabled });
  } catch (error) {
    return errorResponse(error);
  }
}

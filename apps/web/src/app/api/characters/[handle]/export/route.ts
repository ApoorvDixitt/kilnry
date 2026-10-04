// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Export a Character to a .kilnry-character.zip bundle (F-CHR-14, TRD-14 §15).

import { NextResponse } from 'next/server';
import * as z from 'zod';
import { exportCharacterBundle } from '@kilnry/core';
import { errorResponse, requireSession } from '../../../../../server/http';
import { characterBundleServices } from '../../../../../server/character-bundle';

const Body = z.object({
  version: z.number().int().min(1).optional(),
  include_lora: z.boolean().optional(),
  include_release: z.boolean().optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ handle: string }> },
): Promise<Response> {
  try {
    await requireSession();
    const { handle } = await context.params;
    const body = Body.parse(await request.json().catch(() => ({})));
    const services = await characterBundleServices();
    const result = await exportCharacterBundle(services, {
      handle: decodeURIComponent(handle),
      ...(body.version === undefined ? {} : { version: body.version }),
      ...(body.include_lora === undefined ? {} : { include_lora: body.include_lora }),
      ...(body.include_release === undefined ? {} : { include_release: body.include_release }),
    });
    return NextResponse.json({
      bundle_path: result.bundle_path,
      manifest: result.manifest,
      notes: result.notes,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

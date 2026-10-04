// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Import a .kilnry-character.zip bundle (F-CHR-14, TRD-14 §15).

import { NextResponse } from 'next/server';
import * as z from 'zod';
import { importCharacterBundle } from '@kilnry/core';
import { errorResponse, requireSession } from '../../../../server/http';
import { characterBundleServices } from '../../../../server/character-bundle';

const Body = z.object({
  bundle_path: z.string().min(1),
  on_conflict: z.enum(['version', 'rename']).optional(),
  confirm_real_person: z.boolean().optional(),
});

export async function POST(request: Request): Promise<Response> {
  try {
    await requireSession();
    const body = Body.parse(await request.json());
    const services = await characterBundleServices();
    const result = await importCharacterBundle(services, {
      bundle_path: body.bundle_path,
      ...(body.on_conflict === undefined ? {} : { on_conflict: body.on_conflict }),
      ...(body.confirm_real_person === undefined ? {} : { confirm_real_person: body.confirm_real_person }),
    });
    return NextResponse.json({ result });
  } catch (error) {
    return errorResponse(error);
  }
}

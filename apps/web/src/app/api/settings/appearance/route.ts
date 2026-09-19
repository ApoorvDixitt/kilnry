// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextResponse } from 'next/server';
import * as z from 'zod';
import { DensitySchema, loadConfig, ReducedMotionSchema, saveConfig, ThemeSchema } from '@kilnry/core';
import { settings } from '@kilnry/db';
import { errorResponse, requireSession } from '../../../../server/http';
import { runtimeServices } from '../../../../server/runtime';

const Input = z.object({
  theme: ThemeSchema,
  density: DensitySchema,
  reduced_motion: ReducedMotionSchema,
});

export async function PATCH(request: Request): Promise<Response> {
  try {
    await requireSession();
    const input = Input.parse(await request.json());
    const config = loadConfig();
    saveConfig({ ...config, ...input });
    const services = await runtimeServices();
    await services.database.db.transaction(async (transaction) => {
      for (const [key, value] of Object.entries(input)) {
        await transaction
          .insert(settings)
          .values({ key, value })
          .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
      }
    });
    return NextResponse.json({ appearance: input });
  } catch (error) {
    return errorResponse(error);
  }
}

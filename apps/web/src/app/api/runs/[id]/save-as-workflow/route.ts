// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Save a completed run as a new user workflow (F-WFL-10, PRD-10 §8).

import { NextResponse } from 'next/server';
import * as z from 'zod';
import { loadConfig } from '@kilnry/core';
import { errorResponse, requireSession } from '../../../../../server/http';
import { runtimeServices } from '../../../../../server/runtime';
import { saveRunAsWorkflow } from '../../../../../server/workflows';

const Body = z.object({
  name: z.string().min(1).max(80),
  author: z.string().min(1).max(32).optional(),
  // Per-input "make this a field" choices (PRD-10 §8); omitted = all fields.
  fields: z.record(z.string(), z.boolean()).optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireSession();
    const { id } = await context.params;
    const body = Body.parse(await request.json());
    const config = await loadConfig();
    const services = await runtimeServices();
    const result = await saveRunAsWorkflow(
      services.database,
      config.data_dir,
      id,
      body.name,
      body.author,
      body.fields,
    );
    return NextResponse.json({ workflow: result });
  } catch (error) {
    return errorResponse(error);
  }
}

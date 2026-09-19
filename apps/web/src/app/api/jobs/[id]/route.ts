// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { KilnryError, redact } from '@kilnry/core';
import { jobs } from '@kilnry/db';
import { errorResponse, requireSession } from '../../../../server/http';
import { runtimeServices } from '../../../../server/runtime';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireSession();
    const services = await runtimeServices();
    const rows = await services.database.db
      .select()
      .from(jobs)
      .where(eq(jobs.id, (await context.params).id))
      .limit(1);
    if (!rows[0]) throw new KilnryError('NOT_FOUND', 'Job not found.');
    return NextResponse.json({ job: redact(rows[0]) });
  } catch (error) {
    return errorResponse(error);
  }
}

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { desc } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { jobs } from '@kilnry/db';
import { errorResponse, requireSession } from '../../../server/http';
import { runtimeServices } from '../../../server/runtime';

export async function GET(): Promise<Response> {
  try {
    await requireSession();
    const services = await runtimeServices();
    const rows = await services.database.db.select().from(jobs).orderBy(desc(jobs.createdAt)).limit(100);
    return NextResponse.json({ jobs: rows });
  } catch (error) {
    return errorResponse(error);
  }
}

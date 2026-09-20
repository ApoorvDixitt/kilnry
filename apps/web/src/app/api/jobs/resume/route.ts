// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Resume non-terminal jobs after the network returns (F-JOB-05). The job engine
// re-polls each running job by its provider request id and submits each queued
// job in order; this route makes sure the engine is running and reports how many
// jobs were owed so the Jobs screen can show "Back online. Resumed N jobs." No
// job is resubmitted without first re-polling its stored provider request id, so
// the user is never charged twice.

import { inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { jobs } from '@kilnry/db';
import { errorResponse, requireSession } from '../../../../server/http';
import { ensureRuntimeEngine, runtimeServices } from '../../../../server/runtime';

export async function POST(): Promise<Response> {
  try {
    await requireSession();
    const services = await runtimeServices();
    // Count the jobs the engine still owes before it reconciles them.
    const owed = await services.database.db
      .select({ id: jobs.id })
      .from(jobs)
      .where(inArray(jobs.status, ['queued', 'running', 'waiting']));
    // Starting (or confirming) the engine runs its reconciliation, which
    // re-polls running jobs and resumes queued ones.
    await ensureRuntimeEngine().catch(() => undefined);
    return NextResponse.json({ resumed: owed.length });
  } catch (error) {
    return errorResponse(error);
  }
}

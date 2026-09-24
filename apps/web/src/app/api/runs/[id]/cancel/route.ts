// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Cancel a run (F-WFL-03). Every queued or running job is asked to cancel on a
// best-effort basis, pending steps are marked cancelled, and completed outputs
// stay on disk.

import { NextResponse } from 'next/server';
import { errorResponse, requireSession } from '../../../../../server/http';
import { ensureRuntimeEngine, runtimeServices } from '../../../../../server/runtime';
import { cancelRun } from '../../../../../server/workflows';

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireSession();
    const { id } = await context.params;
    const services = await runtimeServices();
    const engine = await ensureRuntimeEngine();
    const state = await cancelRun(services.database, engine, id);
    return NextResponse.json({ run_id: id, status: state.status, spent_usd: state.spent_usd });
  } catch (error) {
    return errorResponse(error);
  }
}

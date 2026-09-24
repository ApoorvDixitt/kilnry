// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Approve a run's checkpoint and continue (F-WFL-04). The waiting approval step is
// marked completed and decided by the owner, and the run resumes from its
// persisted state so no completed step re-runs.

import { NextResponse } from 'next/server';
import { loadConfig } from '@kilnry/core';
import { errorResponse, requireSession } from '../../../../../server/http';
import { ensureRuntimeEngine, runtimeServices } from '../../../../../server/runtime';
import { approveRun } from '../../../../../server/workflows';

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireSession();
    const { id } = await context.params;
    const config = await loadConfig();
    const services = await runtimeServices();
    const engine = await ensureRuntimeEngine();
    const state = await approveRun(services.database, engine, config.data_dir, id);
    return NextResponse.json({ run_id: id, status: state.status, spent_usd: state.spent_usd });
  } catch (error) {
    return errorResponse(error);
  }
}

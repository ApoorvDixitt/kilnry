// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Deny a run's checkpoint (F-WFL-04). The run stops at the barrier with status
// cancelled; the outputs completed before the checkpoint stay on disk.

import { NextResponse } from 'next/server';
import { errorResponse, requireSession } from '../../../../../server/http';
import { runtimeServices } from '../../../../../server/runtime';
import { denyRun } from '../../../../../server/workflows';

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireSession();
    const { id } = await context.params;
    const services = await runtimeServices();
    const state = await denyRun(services.database, id);
    return NextResponse.json({ run_id: id, status: state.status });
  } catch (error) {
    return errorResponse(error);
  }
}

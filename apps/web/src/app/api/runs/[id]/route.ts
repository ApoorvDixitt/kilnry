// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// One run, for the run view (F-WFL-03). The header reads its status, cost so far
// and estimate; the StepList and StepDetail read its steps with their model,
// estimate and actual cost.

import { NextResponse } from 'next/server';
import { loadConfig } from '@kilnry/core';
import { errorResponse, requireSession } from '../../../../server/http';
import { runtimeServices } from '../../../../server/runtime';
import { getRun, getWorkflow } from '../../../../server/workflows';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireSession();
    const { id } = await context.params;
    const services = await runtimeServices();
    const run = await getRun(services.database, id);
    // The workflow's display name, so the run view and its "Save as Workflow"
    // dialog read "Thumbnail" rather than the id `kilnry-thumbnail` (UX-17).
    const config = await loadConfig();
    const workflowName = getWorkflow(config.data_dir, run.workflow_id)?.workflow.name ?? null;
    return NextResponse.json({ run: { ...run, workflow_name: workflowName } });
  } catch (error) {
    return errorResponse(error);
  }
}

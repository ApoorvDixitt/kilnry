// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Plan a workflow (F-WFL-02). The drawer sends the filled-in inputs and gets back
// a priced Plan: every spending step routed and estimated through the one
// estimator every spend uses, with the total and any warnings. Nothing is
// charged; the plan is persisted so the run can check it is still fresh.

import { NextResponse } from 'next/server';
import { loadConfig } from '@kilnry/core';
import * as z from 'zod';
import { errorResponse, requireSession } from '../../../../../server/http';
import { ensureRuntimeEngine, runtimeServices } from '../../../../../server/runtime';
import { planWorkflow } from '../../../../../server/workflows';

const PlanInput = z.object({ inputs: z.record(z.string(), z.unknown()).default({}) });

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireSession();
    const { id } = await context.params;
    const body = PlanInput.parse(await request.json());
    const config = await loadConfig();
    const services = await runtimeServices();
    const engine = await ensureRuntimeEngine();
    const { run_id, plan } = await planWorkflow(services.database, engine, config.data_dir, id, body.inputs);
    return NextResponse.json({ run_id, plan });
  } catch (error) {
    return errorResponse(error);
  }
}

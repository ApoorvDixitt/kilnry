// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Run a workflow against a fresh plan (F-WFL-03). The plan must be under fifteen
// minutes old or the confirmed cost at least nine tenths of its estimate; then
// the run drives every spending step through the engine's estimate → confirm →
// reserve → ledger road, pausing at any checkpoint. Nothing here calls a provider
// adapter directly; a spending step is always a createJob call.

import { NextResponse } from 'next/server';
import { loadConfig } from '@kilnry/core';
import * as z from 'zod';
import { errorResponse, requireSession } from '../../../../../server/http';
import { ensureRuntimeEngine, runtimeServices } from '../../../../../server/runtime';
import { startRun, buildAnalyzeServices } from '../../../../../server/workflows';

const RunInput = z.object({
  run_id: z.string().min(1),
  confirm_cost_usd: z.number().nonnegative(),
  automatic: z.boolean().default(false),
  skip_approvals: z.boolean().default(false),
  target_folder: z.string().optional(),
});

export async function POST(request: Request): Promise<Response> {
  try {
    await requireSession();
    const body = RunInput.parse(await request.json());
    const config = await loadConfig();
    const services = await runtimeServices();
    const engine = await ensureRuntimeEngine();
    const openrouterKey = await services.keyStore.get('openrouter').catch(() => undefined);
    const state = await startRun(
      services.database,
      engine,
      config.data_dir,
      body.run_id,
      body.confirm_cost_usd,
      {
        automatic: body.automatic,
        skipApprovals: body.skip_approvals,
        ...(body.target_folder === undefined ? {} : { targetFolder: body.target_folder }),
        analyze: buildAnalyzeServices(openrouterKey, config.port),
      },
    );
    return NextResponse.json({ run_id: body.run_id, status: state.status, spent_usd: state.spent_usd });
  } catch (error) {
    return errorResponse(error);
  }
}

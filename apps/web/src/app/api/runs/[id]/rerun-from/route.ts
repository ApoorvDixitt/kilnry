// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Re-run from a step as a new child run (F-WFL-05 / F31, PRD-10 §5). A new run
// copies this run's inputs and plan, reuses the outputs of the steps before the
// chosen one at no cost, re-executes the chosen step and everything after it,
// records parent_run_id and writes into a sibling folder with a _rerun suffix.

import { NextResponse } from 'next/server';
import { loadConfig } from '@kilnry/core';
import * as z from 'zod';
import { errorResponse, requireSession } from '../../../../../server/http';
import { ensureRuntimeEngine, runtimeServices } from '../../../../../server/runtime';
import { rerunFromStep, buildAnalyzeServices } from '../../../../../server/workflows';

const RerunInput = z.object({ step_id: z.string().min(1) });

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireSession();
    const { id } = await context.params;
    const body = RerunInput.parse(await request.json());
    const config = await loadConfig();
    const services = await runtimeServices();
    const engine = await ensureRuntimeEngine();
    const openrouterKey = await services.keyStore.get('openrouter').catch(() => undefined);
    const result = await rerunFromStep(
      services.database,
      engine,
      config.data_dir,
      id,
      body.step_id,
      buildAnalyzeServices(openrouterKey, config.port),
    );
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}

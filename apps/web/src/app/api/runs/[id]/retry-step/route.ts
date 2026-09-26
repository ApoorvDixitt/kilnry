// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Retry a failed step, swap its model, or re-run from a step (F-WFL-05). The
// named step and everything downstream of it are reset to pending — optionally
// with a new model — and the run continues from there.

import { NextResponse } from 'next/server';
import { loadConfig } from '@kilnry/core';
import * as z from 'zod';
import { errorResponse, requireSession } from '../../../../../server/http';
import { ensureRuntimeEngine, runtimeServices } from '../../../../../server/runtime';
import { retryStep, buildAnalyzeServices } from '../../../../../server/workflows';

const RetryInput = z.object({ step_id: z.string().min(1), model: z.string().optional() });

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireSession();
    const { id } = await context.params;
    const body = RetryInput.parse(await request.json());
    const config = await loadConfig();
    const services = await runtimeServices();
    const engine = await ensureRuntimeEngine();
    const openrouterKey = await services.keyStore.get('openrouter').catch(() => undefined);
    const state = await retryStep(
      services.database,
      engine,
      config.data_dir,
      id,
      body.step_id,
      body.model,
      buildAnalyzeServices(openrouterKey, config.port),
    );
    return NextResponse.json({ run_id: id, status: state.status, spent_usd: state.spent_usd });
  } catch (error) {
    return errorResponse(error);
  }
}

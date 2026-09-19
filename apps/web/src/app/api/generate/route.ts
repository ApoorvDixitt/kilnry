// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextResponse } from 'next/server';
import { errorResponse, requireSession } from '../../../server/http';
import { canonicalGeneration, GenerationInput } from '../../../server/generation-input';
import { ensureRuntimeEngine } from '../../../server/runtime';

export async function POST(request: Request): Promise<Response> {
  try {
    await requireSession();
    const input = GenerationInput.parse(await request.json());
    const canonical = canonicalGeneration(input);
    const engine = await ensureRuntimeEngine();
    const result = await engine.createJob({
      request: canonical.request,
      constraints: canonical.constraints,
      ...(input.confirmed_cost_usd === undefined ? {} : { confirmed_cost_usd: input.confirmed_cost_usd }),
      confirmed_by: 'user',
      ...(input.client_request_id === undefined ? {} : { client_request_id: input.client_request_id }),
      ...(input.override_budget ? { override_budget: true } : {}),
      ...(input.allow_stale_price ? { allow_stale_price: true } : {}),
    });
    return NextResponse.json({ jobs: [result], total_estimate_usd: result.estimate.estimate_usd });
  } catch (error) {
    return errorResponse(error);
  }
}

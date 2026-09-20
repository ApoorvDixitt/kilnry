// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextResponse } from 'next/server';
import { ulid } from '@kilnry/core';
import { auditEvents } from '@kilnry/db';
import { errorResponse, requireSession } from '../../../server/http';
import { canonicalGeneration, GenerationInput } from '../../../server/generation-input';
import { ensureRuntimeEngine, runtimeServices } from '../../../server/runtime';

export async function POST(request: Request): Promise<Response> {
  try {
    const session = await requireSession();
    const input = GenerationInput.parse(await request.json());
    const canonical = canonicalGeneration(input);
    const engine = await ensureRuntimeEngine();
    // A one-time budget override is recorded so it is visible in the security
    // audit log: the user chose "Allow this once" past a cap set to ask.
    if (input.override_budget) {
      const services = await runtimeServices();
      await services.database.db.insert(auditEvents).values({
        id: ulid(),
        actor: `user:${session.user.id}`,
        action: 'budget.override',
        target: input.model ?? 'auto',
        meta: { confirmed_cost_usd: input.confirmed_cost_usd ?? null },
      });
    }
    // Overriding the 30-day price-staleness guard (F-PRV-07) is recorded too, so
    // a spend priced on stale data is always traceable in the audit log.
    if (input.allow_stale_price) {
      const services = await runtimeServices();
      await services.database.db.insert(auditEvents).values({
        id: ulid(),
        actor: `user:${session.user.id}`,
        action: 'price.stale_override',
        target: input.model ?? 'auto',
        meta: { confirmed_cost_usd: input.confirmed_cost_usd ?? null },
      });
    }
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

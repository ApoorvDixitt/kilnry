// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Per-session chat settings (F-CHT-03). The approval card's "Auto-approve under
// $X for this session" checkbox writes the threshold here, so the next spend at
// or below it proceeds without another card while anything larger still asks.
// The value is scoped to one session and never changes the workspace default.

import { chatSessions } from '@kilnry/db';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import * as z from 'zod';
import { errorResponse, requireSession } from '../../../../server/http';
import { runtimeServices } from '../../../../server/runtime';

const Input = z.object({
  session_id: z.string().min(1),
  auto_approve_below_usd: z.number().min(0).max(1_000).nullable().optional(),
  autonomy: z.enum(['ask_first', 'run_automatically']).optional(),
  budget_usd: z.number().min(0).max(10_000).nullable().optional(),
});

export async function PUT(request: Request): Promise<Response> {
  try {
    await requireSession();
    const input = Input.parse(await request.json());
    const services = await runtimeServices();

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.auto_approve_below_usd !== undefined) {
      patch['autoApproveBelowUsd'] =
        input.auto_approve_below_usd === null ? null : String(input.auto_approve_below_usd);
    }
    if (input.autonomy !== undefined) patch['autonomy'] = input.autonomy;
    if (input.budget_usd !== undefined) {
      patch['budgetUsd'] = input.budget_usd === null ? null : String(input.budget_usd);
    }

    await services.database.db.update(chatSessions).set(patch).where(eq(chatSessions.id, input.session_id));

    return NextResponse.json({ session: { id: input.session_id, ...patch } });
  } catch (error) {
    return errorResponse(error);
  }
}

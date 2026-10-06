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
import { chatSessionDefaults, sessionRowDefaults } from '../../../../server/chat-session';
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

    // The Chat page can change autonomy or the budget before its first message
    // has created the session row. An UPDATE of no row reported success while
    // the change was lost (F-115), so the row is created here from the
    // workspace defaults with the patch applied, or the patch updates it.
    const defaults = await chatSessionDefaults(services.database);
    await services.database.db
      .insert(chatSessions)
      .values({ id: input.session_id, ...sessionRowDefaults(defaults), ...patch })
      .onConflictDoUpdate({ target: chatSessions.id, set: patch });
    const rows = await services.database.db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, input.session_id))
      .limit(1);
    const row = rows[0]!;

    return NextResponse.json({
      session: {
        id: row.id,
        autonomy: row.autonomy,
        budget_usd: row.budgetUsd === null ? null : Number(row.budgetUsd),
        auto_approve_below_usd: row.autoApproveBelowUsd === null ? null : Number(row.autoApproveBelowUsd),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

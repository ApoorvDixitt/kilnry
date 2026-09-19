// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextResponse } from 'next/server';
import * as z from 'zod';
import { budgetStatus } from '@kilnry/core';
import { budgets } from '@kilnry/db';
import { errorResponse, requireSession } from '../../../server/http';
import { runtimeServices } from '../../../server/runtime';

const SetCap = z.object({
  scope: z.string().min(1).max(120),
  cap_usd: z.number().nonnegative().nullable(),
  behavior: z.enum(['block', 'ask']).default('block'),
});

export async function GET(): Promise<Response> {
  try {
    await requireSession();
    const services = await runtimeServices();
    const lines = await budgetStatus(services.database.db);
    return NextResponse.json({ budgets: lines });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    await requireSession();
    const input = SetCap.parse(await request.json());
    const services = await runtimeServices();
    await services.database.db
      .insert(budgets)
      .values({
        scope: input.scope,
        capUsd: input.cap_usd === null ? null : String(input.cap_usd),
        behavior: input.behavior,
      })
      .onConflictDoUpdate({
        target: budgets.scope,
        set: {
          capUsd: input.cap_usd === null ? null : String(input.cap_usd),
          behavior: input.behavior,
          updatedAt: new Date(),
        },
      });
    const lines = await budgetStatus(services.database.db);
    return NextResponse.json({ budgets: lines });
  } catch (error) {
    return errorResponse(error);
  }
}

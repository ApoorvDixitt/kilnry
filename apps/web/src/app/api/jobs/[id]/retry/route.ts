// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextResponse } from 'next/server';
import * as z from 'zod';
import { errorResponse, requireSession } from '../../../../../server/http';
import { ensureRuntimeEngine } from '../../../../../server/runtime';

const Input = z.object({ confirmed_cost_usd: z.number().nonnegative() });

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireSession();
    const input = Input.parse(await request.json());
    const engine = await ensureRuntimeEngine();
    await engine.retryJob((await context.params).id, input.confirmed_cost_usd);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

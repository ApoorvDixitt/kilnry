// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextResponse } from 'next/server';
import { errorResponse, requireSession } from '../../../../../server/http';
import { ensureRuntimeEngine } from '../../../../../server/runtime';

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireSession();
    const engine = await ensureRuntimeEngine();
    return NextResponse.json(await engine.cancelJob((await context.params).id));
  } catch (error) {
    return errorResponse(error);
  }
}

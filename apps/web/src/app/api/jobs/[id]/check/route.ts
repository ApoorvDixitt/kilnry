// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Check a failed job's provider status without resubmitting (S-11, F-JOB-04).
// The engine re-polls the stored provider request id; if the provider has since
// finished, the job downloads and completes on its original estimate, so the
// user is never charged twice. This is the safe alternative the failed-row copy
// steers the user to before any Retry.

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
    await engine.checkJob((await context.params).id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

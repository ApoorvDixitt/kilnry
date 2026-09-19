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
    const result = await engine.estimate(canonical.request, canonical.constraints);
    return NextResponse.json({ ...result.estimate, request: result.request });
  } catch (error) {
    return errorResponse(error);
  }
}

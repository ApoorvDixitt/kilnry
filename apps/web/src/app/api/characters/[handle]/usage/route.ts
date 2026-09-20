// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextResponse } from 'next/server';
import { parseHandlePin, usageAssets } from '@kilnry/core';
import { errorResponse, requireSession } from '../../../../../server/http';
import { runtimeServices } from '../../../../../server/runtime';

// Every asset made with this Character, newest first (Usage tab, F-CHR-11).
export async function GET(
  request: Request,
  context: { params: Promise<{ handle: string }> },
): Promise<Response> {
  try {
    await requireSession();
    const { handle } = await context.params;
    const pin = parseHandlePin(decodeURIComponent(handle));
    const limit = Math.min(Number(new URL(request.url).searchParams.get('limit') ?? 60) || 60, 200);
    const services = await runtimeServices();
    const items = await usageAssets(services.database, pin.handle, limit);
    return NextResponse.json({ items });
  } catch (error) {
    return errorResponse(error);
  }
}

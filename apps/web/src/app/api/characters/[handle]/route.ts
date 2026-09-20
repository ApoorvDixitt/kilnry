// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextResponse } from 'next/server';
import { loadFullCharacter, parseHandlePin } from '@kilnry/core';
import { errorResponse, requireSession } from '../../../../server/http';
import { runtimeServices } from '../../../../server/runtime';

// The full Character for the detail page (F-CHR-03). The handle may pin a version
// as `maya@v2`.
export async function GET(
  _request: Request,
  context: { params: Promise<{ handle: string }> },
): Promise<Response> {
  try {
    await requireSession();
    const { handle } = await context.params;
    const pin = parseHandlePin(decodeURIComponent(handle));
    const services = await runtimeServices();
    const item = await loadFullCharacter(services.database, pin.handle, pin.version);
    return NextResponse.json({ item });
  } catch (error) {
    return errorResponse(error);
  }
}

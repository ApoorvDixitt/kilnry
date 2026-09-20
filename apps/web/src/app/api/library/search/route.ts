// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextResponse } from 'next/server';
import { parseSearchQuery, searchAssets } from '@kilnry/core';
import { errorResponse, requireSession } from '../../../../server/http';
import { runtimeServices } from '../../../../server/runtime';

export async function GET(request: Request): Promise<Response> {
  try {
    await requireSession();
    const params = new URL(request.url).searchParams;
    const query = params.get('q') ?? '';
    const character = params.get('character');
    const services = await runtimeServices();
    const parsed = parseSearchQuery(query);
    // The Library "by character" filter (F-CHR-11) may arrive as a dedicated
    // parameter as well as inline in the query.
    if (character) parsed.handles.push(character.replace(/^@/, '').toLowerCase());
    const results = await searchAssets(services.database, parsed);
    return NextResponse.json({ assets: results });
  } catch (error) {
    return errorResponse(error);
  }
}

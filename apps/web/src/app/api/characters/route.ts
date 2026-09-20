// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextResponse } from 'next/server';
import { listCards, type CharacterKind } from '@kilnry/core';
import { errorResponse, requireSession } from '../../../server/http';
import { runtimeServices } from '../../../server/runtime';

const KINDS: CharacterKind[] = ['character', 'prop', 'environment', 'style'];

// List Characters (or Elements) for the grid. `?kind=` pins the tab; `?q=` and
// `?tags=` filter (F-CHR-01, F-ELM-01).
export async function GET(request: Request): Promise<Response> {
  try {
    await requireSession();
    const params = new URL(request.url).searchParams;
    const kindParam = params.get('kind');
    const kind =
      kindParam && KINDS.includes(kindParam as CharacterKind) ? (kindParam as CharacterKind) : undefined;
    const query = params.get('q') ?? undefined;
    const tags = params.get('tags')?.split(',').filter(Boolean) ?? undefined;
    const services = await runtimeServices();
    const items = await listCards(services.database, {
      ...(kind ? { kind } : {}),
      ...(query ? { query } : {}),
      ...(tags && tags.length > 0 ? { tags } : {}),
    });
    return NextResponse.json({ items });
  } catch (error) {
    return errorResponse(error);
  }
}

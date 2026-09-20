// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextResponse } from 'next/server';
import { mentionSuggestions, type CharacterKind } from '@kilnry/core';
import { errorResponse, requireSession } from '../../../../server/http';
import { runtimeServices } from '../../../../server/runtime';

const KINDS: CharacterKind[] = ['character', 'prop', 'environment', 'style'];

// The @ mention autocomplete (F-CRE-02): matches handle and display name, returns
// lightweight items with a thumbnail for the composer popover.
export async function GET(request: Request): Promise<Response> {
  try {
    await requireSession();
    const params = new URL(request.url).searchParams;
    const query = params.get('q') ?? '';
    const kindsParam = params
      .get('kinds')
      ?.split(',')
      .map((k) => k.trim())
      .filter((k): k is CharacterKind => KINDS.includes(k as CharacterKind));
    const limit = Math.min(Number(params.get('limit') ?? 8) || 8, 20);
    const services = await runtimeServices();
    const items = await mentionSuggestions(
      services.database,
      query,
      kindsParam && kindsParam.length > 0 ? kindsParam : KINDS,
      limit,
    );
    return NextResponse.json({ items });
  } catch (error) {
    return errorResponse(error);
  }
}

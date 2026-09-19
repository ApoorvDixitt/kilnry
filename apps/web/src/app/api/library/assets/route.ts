// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextResponse } from 'next/server';
import { listAssets, type AssetSort } from '@kilnry/core';
import { errorResponse, requireSession } from '../../../../server/http';
import { runtimeServices } from '../../../../server/runtime';

const SORTS: AssetSort[] = ['newest', 'oldest', 'name', 'cost', 'duration'];

export async function GET(request: Request): Promise<Response> {
  try {
    await requireSession();
    const url = new URL(request.url);
    const folder = url.searchParams.get('folder') ?? 'inbox';
    const sortParam = url.searchParams.get('sort') ?? 'newest';
    const sort: AssetSort = SORTS.includes(sortParam as AssetSort) ? (sortParam as AssetSort) : 'newest';
    const includeSubfolders = url.searchParams.get('subfolders') === '1';
    const services = await runtimeServices();
    const list = await listAssets(services.database, { folder, sort, includeSubfolders });
    return NextResponse.json({ assets: list });
  } catch (error) {
    return errorResponse(error);
  }
}

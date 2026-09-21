// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextResponse } from 'next/server';
import { clearCache, diskStatus, loadConfig } from '@kilnry/core';
import { errorResponse, requireSession } from '../../../../server/http';

// The disk status for the banner (F-LIB-13). GET returns the level and the cache
// size; POST clears the regenerable cache and returns the bytes reclaimed.
export async function GET(): Promise<Response> {
  try {
    await requireSession();
    const config = loadConfig();
    const status = await diskStatus(config.data_dir);
    return NextResponse.json({ status });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(): Promise<Response> {
  try {
    await requireSession();
    const config = loadConfig();
    const cleared = await clearCache(config.data_dir);
    const status = await diskStatus(config.data_dir);
    return NextResponse.json({ cleared_bytes: cleared, status });
  } catch (error) {
    return errorResponse(error);
  }
}

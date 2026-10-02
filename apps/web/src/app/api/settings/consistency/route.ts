// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextResponse } from 'next/server';
import * as z from 'zod';
import { loadConfig } from '@kilnry/core';
import { errorResponse, requireSession } from '../../../../server/http';
import { consistencyStatus, disableConsistency, enableConsistency } from '../../../../server/consistency';
import { ensureRuntimeEngine, runtimeServices } from '../../../../server/runtime';

const Input = z.object({ enabled: z.boolean() });

// The consistency check's state: on or off, whether the files are installed,
// the download size, and the download progress (F-CHR-12).
export async function GET(): Promise<Response> {
  try {
    await requireSession();
    return NextResponse.json(await consistencyStatus());
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    await requireSession();
    const input = Input.parse(await request.json());
    if (input.enabled) {
      await ensureRuntimeEngine();
      const services = await runtimeServices();
      const config = loadConfig();
      if (!config.library_root)
        throw new Error('Choose a Library root before enabling the consistency check.');
      await enableConsistency(services.database, config.library_root);
    } else {
      disableConsistency();
    }
    return NextResponse.json(await consistencyStatus());
  } catch (error) {
    return errorResponse(error);
  }
}

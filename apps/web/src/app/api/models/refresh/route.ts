// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextResponse } from 'next/server';
import * as z from 'zod';
import { ProviderIdSchema, refreshProviderPrices } from '@kilnry/core';
import { adapters } from '@kilnry/providers';
import { errorResponse, requireSession } from '../../../../server/http';
import { ensureRuntimeEngine, runtimeServices } from '../../../../server/runtime';

const Input = z.object({ provider: ProviderIdSchema });

export async function POST(request: Request): Promise<Response> {
  try {
    await requireSession();
    await ensureRuntimeEngine();
    const input = Input.parse(await request.json());
    const services = await runtimeServices();
    return NextResponse.json(
      await refreshProviderPrices({
        state: services.database,
        keyStore: services.keyStore,
        adapters,
        provider: input.provider,
        dataDir: services.database.dataDir,
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

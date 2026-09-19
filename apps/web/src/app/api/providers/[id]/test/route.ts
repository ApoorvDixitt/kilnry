// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextResponse } from 'next/server';
import { ProviderIdSchema, testProvider } from '@kilnry/core';
import { adapters } from '@kilnry/providers';
import { errorResponse, requireSession } from '../../../../../server/http';
import { ensureRuntimeEngine, runtimeServices } from '../../../../../server/runtime';

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireSession();
    await ensureRuntimeEngine();
    const provider = ProviderIdSchema.parse((await context.params).id);
    const services = await runtimeServices();
    return NextResponse.json(
      await testProvider({
        state: services.database,
        keyStore: services.keyStore,
        adapters,
        provider,
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

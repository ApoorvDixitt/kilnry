// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextResponse } from 'next/server';
import { loadRegistry, providerRouteStates } from '@kilnry/core';
import { errorResponse, requireSession } from '../../../server/http';
import { runtimeServices } from '../../../server/runtime';

export async function GET(): Promise<Response> {
  try {
    await requireSession();
    const services = await runtimeServices();
    const [registry, providerStates] = await Promise.all([
      loadRegistry(services.database),
      providerRouteStates(services.database),
    ]);
    return NextResponse.json({
      models: registry.models.map((model) => ({
        ...model,
        connected: providerStates[model.provider]?.connected ?? false,
        price: registry.snapshots.get(`${model.provider}:${model.model_id}`),
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

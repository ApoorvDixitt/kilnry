// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextResponse } from 'next/server';
import { loadRegistry, priceSummary, providerRouteStates } from '@kilnry/core';
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
      models: registry.models.map((model) => {
        const snapshot = registry.snapshots.get(`${model.provider}:${model.model_id}`);
        const summary = snapshot ? priceSummary(snapshot.rule) : undefined;
        return {
          ...model,
          connected: providerStates[model.provider]?.connected ?? false,
          price:
            snapshot && summary
              ? {
                  unit: summary.unit,
                  amount_usd: summary.amount,
                  fetched_at: snapshot.fetched_at,
                  source_url: snapshot.source_url,
                }
              : undefined,
        };
      }),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

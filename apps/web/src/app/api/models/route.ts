// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextResponse } from 'next/server';
import { loadRegistry, priceSummary, providerRouteStates } from '@kilnry/core';
import { errorResponse, requireSession } from '../../../server/http';
import { log } from '../../../server/log';
import { runtimeServices } from '../../../server/runtime';

const unpricedLogged = new Set<string>();

function logUnpricedOnce(key: string): void {
  if (unpricedLogged.has(key)) return;
  unpricedLogged.add(key);
  log.warn({ model: key }, 'model_without_price');
}

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
        // PRD-05:111: "a row without a price in the registry is not rendered and
        // is logged." The picker dropped it with no trace (F-109); the server
        // logs each such model once per process.
        if (!snapshot || !summary) logUnpricedOnce(`${model.provider}:${model.model_id}`);
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
                  // A token-table figure is computed, so the row shows it with ≈
                  // (PRD-05:92, design contract rule 11).
                  ...(summary.estimated ? { estimated: true } : {}),
                }
              : undefined,
        };
      }),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Settings › Providers, the stored options that are not a key (F-SET-02).
// Today that is the price-age threshold PRD-14 §8 names — "models.price_rule
// older than settings.price_max_age_days (30, default; adjustable)" — which was
// a hard-coded 30 in the estimator and the enforcer, so nothing could change it
// (D-73a). Nothing here spends.

import { NextResponse } from 'next/server';
import * as z from 'zod';
import {
  PRICE_MAX_AGE_DAYS_MAX,
  PRICE_MAX_AGE_DAYS_MIN,
  PRICE_MAX_AGE_SETTING,
  priceMaxAgeDays,
} from '@kilnry/core';
import { settings } from '@kilnry/db';
import { errorResponse, requireSession } from '../../../../server/http';
import { runtimeServices } from '../../../../server/runtime';

const Input = z.object({
  price_max_age_days: z.number().int().min(PRICE_MAX_AGE_DAYS_MIN).max(PRICE_MAX_AGE_DAYS_MAX).optional(),
});

export async function GET(): Promise<Response> {
  try {
    await requireSession();
    const services = await runtimeServices();
    return NextResponse.json({
      providers: { price_max_age_days: await priceMaxAgeDays(services.database) },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    await requireSession();
    const input = Input.parse(await request.json());
    const services = await runtimeServices();
    if (input.price_max_age_days !== undefined) {
      await services.database.db
        .insert(settings)
        .values({ key: PRICE_MAX_AGE_SETTING, value: input.price_max_age_days })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value: input.price_max_age_days, updatedAt: new Date() },
        });
    }
    return NextResponse.json({
      providers: { price_max_age_days: await priceMaxAgeDays(services.database) },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

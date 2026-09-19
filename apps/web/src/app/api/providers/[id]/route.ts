// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextResponse } from 'next/server';
import * as z from 'zod';
import { ProviderIdSchema, listProviders, updateProviderControls } from '@kilnry/core';
import { adapters } from '@kilnry/providers';
import { errorResponse, requireSession } from '../../../../server/http';
import { runtimeServices } from '../../../../server/runtime';

const Input = z
  .object({
    monthly_cap_usd: z.number().nonnegative().nullable().optional(),
    max_concurrency: z.number().int().min(1).max(32).optional(),
    resume: z.boolean().optional(),
  })
  .refine(
    (value) => Object.values(value).some((item) => item !== undefined),
    'No provider setting supplied.',
  );

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireSession();
    const provider = ProviderIdSchema.parse((await context.params).id);
    const input = Input.parse(await request.json());
    const services = await runtimeServices();
    await updateProviderControls(services.database, provider, {
      ...(input.monthly_cap_usd === undefined ? {} : { monthly_cap_usd: input.monthly_cap_usd }),
      ...(input.max_concurrency === undefined ? {} : { max_concurrency: input.max_concurrency }),
      ...(input.resume === undefined ? {} : { resume: input.resume }),
    });
    const summary = (await listProviders(services.database, adapters)).find((item) => item.id === provider);
    return NextResponse.json({ provider: summary });
  } catch (error) {
    return errorResponse(error);
  }
}

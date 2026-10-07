// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { desc, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { jobs, models } from '@kilnry/db';
import { errorResponse, requireSession } from '../../../server/http';
import { runtimeServices } from '../../../server/runtime';

export async function GET(): Promise<Response> {
  try {
    await requireSession();
    const services = await runtimeServices();
    const rows = await services.database.db.select().from(jobs).orderBy(desc(jobs.createdAt)).limit(100);
    // The Model column reads the registry's display name, with the id kept for
    // the tooltip, so one model has one name across the picker, the strip and
    // this table (UX-08). A model that has left the registry keeps its id.
    const keys = [...new Set(rows.map((row) => row.modelId).filter((id): id is string => Boolean(id)))];
    const named =
      keys.length === 0
        ? []
        : await services.database.db
            .select({
              providerId: models.providerId,
              modelId: models.modelId,
              displayName: models.displayName,
            })
            .from(models)
            .where(inArray(models.modelId, keys));
    const names = new Map(named.map((row) => [`${row.providerId}:${row.modelId}`, row.displayName]));
    return NextResponse.json({
      jobs: rows.map((row) => ({
        ...row,
        modelName: row.modelId ? (names.get(`${row.providerId ?? ''}:${row.modelId}`) ?? null) : null,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

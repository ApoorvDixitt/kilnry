// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextResponse } from 'next/server';
import * as z from 'zod';
import { KilnryError, libraryMarker, loadConfig, updateAssetMetadata } from '@kilnry/core';
import { errorResponse, requireSession } from '../../../../../server/http';
import { runtimeServices } from '../../../../../server/runtime';

const MetadataPatch = z.object({
  tags: z.array(z.string().max(32)).max(64).optional(),
  label: z.string().max(16).nullable().optional(),
  rating: z.number().int().min(0).max(5).optional(),
  user_notes: z.string().max(20_000).optional(),
  prompt: z.string().max(20_000).optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireSession();
    const { id } = await context.params;
    const patch = MetadataPatch.parse(await request.json());
    const config = loadConfig();
    if (!config.library_root) throw new KilnryError('NOT_FOUND', 'Library root is not configured.');
    const services = await runtimeServices();
    const marker = await libraryMarker(config.library_root);
    await updateAssetMetadata(services.database, config.library_root, marker.library_id, id, patch);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

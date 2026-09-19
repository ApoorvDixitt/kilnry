// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextResponse } from 'next/server';
import * as z from 'zod';
import { KilnryError, importFolder, libraryMarker, loadConfig } from '@kilnry/core';
import { errorResponse, requireSession } from '../../../../server/http';
import { runtimeServices } from '../../../../server/runtime';

const ImportRequest = z.object({ folder: z.string().max(900).default('') });

export async function POST(request: Request): Promise<Response> {
  try {
    await requireSession();
    const input = ImportRequest.parse(await request.json());
    const config = loadConfig();
    if (!config.library_root) throw new KilnryError('NOT_FOUND', 'Library root is not configured.');
    const services = await runtimeServices();
    const marker = await libraryMarker(config.library_root);
    const report = await importFolder(
      services.database,
      config.library_root,
      marker.library_id,
      input.folder,
      {
        dataDir: config.data_dir,
      },
    );
    return NextResponse.json({ report });
  } catch (error) {
    return errorResponse(error);
  }
}

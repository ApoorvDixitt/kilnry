// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextResponse } from 'next/server';
import { KilnryError, libraryMarker, loadConfig, reindexLibrary } from '@kilnry/core';
import { errorResponse, requireSession } from '../../../../server/http';
import { runtimeServices } from '../../../../server/runtime';

function doctorRequest(request: Request): boolean {
  const host = new URL(request.url).hostname;
  return (
    ['127.0.0.1', 'localhost', '::1'].includes(host) && request.headers.get('x-kilnry-doctor') === 'reindex'
  );
}

export async function POST(request: Request): Promise<Response> {
  try {
    if (!doctorRequest(request)) await requireSession();
    const config = loadConfig();
    if (!config.library_root) throw new KilnryError('NOT_FOUND', 'Library root is not configured.');
    const services = await runtimeServices();
    const marker = await libraryMarker(config.library_root);
    const report = await reindexLibrary(services.database, config.library_root, marker.library_id, {
      reportDir: `${config.data_dir}/logs`,
    });
    return NextResponse.json({ ok: true, report });
  } catch (error) {
    return errorResponse(error);
  }
}

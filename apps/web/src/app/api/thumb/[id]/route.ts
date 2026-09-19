// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { eq } from 'drizzle-orm';
import { KilnryError, loadConfig, parseUlid, resolveInRoot } from '@kilnry/core';
import { assets } from '@kilnry/db';
import { createThumbnail } from '@kilnry/media';
import { errorResponse, requireSession } from '../../../../server/http';
import { runtimeServices } from '../../../../server/runtime';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireSession();
    const id = parseUlid((await context.params).id, 'asset id');
    const services = await runtimeServices();
    const path = join(loadConfig().data_dir, 'cache', 'thumbs', `${id}.webp`);
    if (!existsSync(path)) {
      const rows = await services.database.db.select().from(assets).where(eq(assets.id, id)).limit(1);
      const row = rows[0];
      const root = loadConfig().library_root;
      if (!row || !root) throw new KilnryError('NOT_FOUND', 'Thumbnail source not found.');
      const source = await resolveInRoot(root, row.path, { mustExist: true });
      const result = await createThumbnail(source.abs, path, row.mime ?? 'application/octet-stream');
      if (!result.created)
        throw new KilnryError('NOT_FOUND', 'Thumbnail is not available for this media type.');
    }
    const file = await stat(path);
    return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>, {
      headers: {
        'Content-Type': 'image/webp',
        'Content-Length': String(file.size),
        'Cache-Control': 'private, max-age=31536000, immutable',
        'Cross-Origin-Resource-Policy': 'same-origin',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

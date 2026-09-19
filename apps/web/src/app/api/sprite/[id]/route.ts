// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { KilnryError, loadConfig, parseUlid } from '@kilnry/core';
import { errorResponse, requireSession } from '../../../../server/http';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireSession();
    const id = parseUlid((await context.params).id, 'asset id');
    const path = join(loadConfig().data_dir, 'cache', 'sprites', `${id}.webp`);
    if (!existsSync(path)) throw new KilnryError('NOT_FOUND', 'Sprite is not available.');
    const file = await stat(path);
    const metadataPath = `${path}.json`;
    const metadata = existsSync(metadataPath)
      ? readFileSync(metadataPath, 'utf8').trim()
      : JSON.stringify({ frames: 10, w: 160 });
    return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>, {
      headers: {
        'Content-Type': 'image/webp',
        'Content-Length': String(file.size),
        'Cache-Control': 'private, max-age=31536000, immutable',
        'X-Kilnry-Sprite': metadata,
        'Cross-Origin-Resource-Policy': 'same-origin',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

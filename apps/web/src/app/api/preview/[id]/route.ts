// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { loadConfig, parseUlid } from '@kilnry/core';
import { errorResponse, requireSession } from '../../../../server/http';

async function respond(request: Request, id: string): Promise<Response> {
  await requireSession();
  const assetId = parseUlid(id, 'asset id');
  const path = join(loadConfig().data_dir, 'cache', 'previews', `${assetId}.mp4`);
  if (!existsSync(path)) return new Response(null, { status: 202, headers: { 'Retry-After': '2' } });
  const file = await stat(path);
  const range = request.headers.get('range');
  let start = 0;
  let end = file.size - 1;
  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (!match)
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${file.size}` } });
    start = Number(match[1]);
    end = match[2]
      ? Math.min(file.size - 1, Number(match[2]))
      : Math.min(file.size - 1, start + 8 * 1024 * 1024 - 1);
    if (start < 0 || start > end || start >= file.size)
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${file.size}` } });
  }
  const stream = createReadStream(path, { start, end });
  request.signal.addEventListener('abort', () => stream.destroy(), { once: true });
  return new Response(
    request.method === 'HEAD' ? null : (Readable.toWeb(stream) as ReadableStream<Uint8Array>),
    {
      status: range ? 206 : 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Content-Length': String(end - start + 1),
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${file.size}` } : {}),
        'Cache-Control': 'private, max-age=31536000, immutable',
        'Cross-Origin-Resource-Policy': 'same-origin',
      },
    },
  );
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    return await respond(request, (await context.params).id);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function HEAD(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    return await respond(request, (await context.params).id);
  } catch (error) {
    return errorResponse(error);
  }
}

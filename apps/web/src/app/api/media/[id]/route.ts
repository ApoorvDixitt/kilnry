// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { Readable } from 'node:stream';
import { eq } from 'drizzle-orm';
import { KilnryError, parseUlid, resolveInRoot } from '@kilnry/core';
import { assets } from '@kilnry/db';
import { sniffMime } from '@kilnry/media';
import { errorResponse, requireSession } from '../../../../server/http';
import { runtimeServices } from '../../../../server/runtime';

type ByteRange = { start: number; end: number } | 'invalid' | undefined;

function parseRange(value: string | null, size: number): ByteRange {
  if (!value) return undefined;
  if (!value.startsWith('bytes=') || value.includes(',')) return 'invalid';
  const [startText, endText] = value.slice(6).split('-', 2);
  if (!startText && !endText) return 'invalid';
  if (!startText) {
    const suffix = Number(endText);
    if (!Number.isInteger(suffix) || suffix <= 0) return 'invalid';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(startText);
  if (!Number.isInteger(start) || start < 0 || start >= size) return 'invalid';
  const requestedEnd = endText ? Number(endText) : Math.min(size - 1, start + 8 * 1024 * 1024 - 1);
  if (!Number.isInteger(requestedEnd) || requestedEnd < start) return 'invalid';
  return { start, end: Math.min(size - 1, requestedEnd) };
}

async function respond(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  await requireSession();
  const id = parseUlid((await context.params).id, 'asset id');
  const services = await runtimeServices();
  const rows = await services.database.db.select().from(assets).where(eq(assets.id, id)).limit(1);
  const row = rows[0];
  if (!row || (row.trashedAt && new URL(request.url).searchParams.get('trash') !== '1')) {
    throw new KilnryError('NOT_FOUND', 'Asset not found.');
  }
  const { loadConfig } = await import('@kilnry/core/config');
  const root = loadConfig().library_root;
  if (!root) throw new KilnryError('NOT_FOUND', 'Library root is not configured.');
  const resolved = await resolveInRoot(root, row.path, { mustExist: true });
  const file = await stat(resolved.abs);
  const etag = `"${row.sha256 ?? `${file.size.toString(16)}-${Math.trunc(file.mtimeMs).toString(16)}`}"`;
  const baseHeaders: Record<string, string> = {
    ETag: etag,
    'Last-Modified': file.mtime.toUTCString(),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=0, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Disposition': `${new URL(request.url).searchParams.get('download') === '1' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(basename(row.path))}`,
  };
  if (request.headers.get('if-none-match') === etag)
    return new Response(null, { status: 304, headers: baseHeaders });
  const mime = row.mime ?? (await sniffMime(resolved.abs));
  const requestedRange =
    request.headers.get('if-range') && request.headers.get('if-range') !== etag
      ? undefined
      : parseRange(request.headers.get('range'), file.size);
  if (requestedRange === 'invalid') {
    return new Response(null, {
      status: 416,
      headers: { ...baseHeaders, 'Content-Range': `bytes */${file.size}` },
    });
  }
  if (request.method === 'HEAD') {
    return new Response(null, {
      status: 200,
      headers: { ...baseHeaders, 'Content-Type': mime, 'Content-Length': String(file.size) },
    });
  }
  const range = requestedRange;
  const source = range
    ? createReadStream(resolved.abs, { start: range.start, end: range.end })
    : createReadStream(resolved.abs);
  request.signal.addEventListener('abort', () => source.destroy(), { once: true });
  return new Response(Readable.toWeb(source) as ReadableStream<Uint8Array>, {
    status: range ? 206 : 200,
    headers: {
      ...baseHeaders,
      'Content-Type': mime === 'application/octet-stream' ? 'application/octet-stream' : mime,
      'Content-Length': String(range ? range.end - range.start + 1 : file.size),
      ...(range ? { 'Content-Range': `bytes ${range.start}-${range.end}/${file.size}` } : {}),
    },
  });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    return await respond(request, context);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function HEAD(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    return await respond(request, context);
  } catch (error) {
    return errorResponse(error);
  }
}

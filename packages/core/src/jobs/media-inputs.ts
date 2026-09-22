// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Turning a Library asset into something a provider will accept (TRD-06 §1's
// `fileInput`). A provider never reads the user's disk, so every media input a
// job carries has to become either a public address or inline bytes before the
// request is submitted. The order is the one the adapter chapter sets out: an
// address that is already public is used as it is, otherwise the file is
// uploaded to the provider's own storage when that provider offers one, and
// otherwise a small file travels inline as a data address.

import { readFile } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { assets, type DatabaseState } from '@kilnry/db';
import { KilnryError } from '../errors.js';
import type { AdapterContext, ProviderAdapter } from '../providers/adapter.js';
import type { CanonicalRequest } from '../types.js';
import { join } from 'node:path';

// The largest file Kilnry will inline rather than upload (TRD-06 §3.1: data
// addresses are for files under one megabyte).
export const DATA_URI_MAX_BYTES = 1_000_000;

const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
};

function mimeFor(path: string): string {
  const dot = path.lastIndexOf('.');
  const extension = dot === -1 ? '' : path.slice(dot).toLowerCase();
  return MIME_BY_EXTENSION[extension] ?? 'application/octet-stream';
}

function isPublicUrl(value: string | undefined): boolean {
  return typeof value === 'string' && /^https:\/\//i.test(value);
}

// Where a Library asset's bytes live. The index stores the path relative to the
// Library root, so a job that only knows an asset id can still read the file.
async function assetPath(
  state: DatabaseState,
  libraryRoot: string,
  assetId: string,
): Promise<{ path: string; mime: string } | undefined> {
  const rows = await state.db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
  const row = rows[0];
  if (!row?.path) return undefined;
  const full = row.path.startsWith('/') ? row.path : join(libraryRoot, row.path);
  return { path: full, mime: row.mime ?? mimeFor(full) };
}

/**
 * Give every media input on the request something the provider can fetch. The
 * request is returned unchanged when nothing needs resolving, so a job with no
 * media inputs costs nothing extra.
 */
export async function resolveMediaInputs(
  request: CanonicalRequest,
  options: {
    state: DatabaseState;
    libraryRoot: string;
    adapter: ProviderAdapter;
    context: AdapterContext;
  },
): Promise<CanonicalRequest> {
  if (request.medias.length === 0) return request;
  if (request.medias.every((media) => isPublicUrl(media.url))) return request;

  const medias = [] as CanonicalRequest['medias'];
  for (const media of request.medias) {
    if (isPublicUrl(media.url)) {
      medias.push(media);
      continue;
    }
    const located = media.asset_id
      ? await assetPath(options.state, options.libraryRoot, media.asset_id)
      : media.url && media.url.startsWith('/')
        ? { path: media.url, mime: mimeFor(media.url) }
        : undefined;
    if (!located) {
      throw new KilnryError(
        'INVALID_INPUT',
        'That input is not in the Library, so it cannot be sent to the provider.',
      );
    }
    const bytes = await readFile(located.path);
    if (options.adapter.uploadFile) {
      const uploaded = await options.adapter.uploadFile(
        {
          bytes: new Uint8Array(bytes),
          mime: located.mime,
          file_name: located.path.split('/').pop() ?? 'input',
        },
        options.context,
      );
      medias.push({ ...media, url: uploaded.url });
      continue;
    }
    if (bytes.byteLength > DATA_URI_MAX_BYTES) {
      throw new KilnryError(
        'INVALID_INPUT',
        `${options.adapter.display_name} needs a file under 1 MB when it has no upload of its own; this one is ${Math.round(bytes.byteLength / 1000)} kB.`,
      );
    }
    medias.push({ ...media, url: `data:${located.mime};base64,${bytes.toString('base64')}` });
  }
  return { ...request, medias };
}

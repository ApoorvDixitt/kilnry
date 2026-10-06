// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { NextResponse } from 'next/server';
import * as z from 'zod';
import {
  KilnryError,
  importFolder,
  indexAsset,
  libraryMarker,
  loadConfig,
  resolveInRoot,
} from '@kilnry/core';
import { errorResponse, requireSession } from '../../../../server/http';
import { runtimeServices } from '../../../../server/runtime';

const ImportRequest = z.object({ folder: z.string().max(900).default('') });

// The browser's drop and file-pick path (TRD-16 §3: "`kilnry_import` input **or**
// `multipart/form-data` (files ≤ 20, 4 GB each, streamed to `inbox/` or
// `target_folder`)"). Creating a Character from photos posts exactly this
// (create-character.tsx), and the route used to read JSON only, so every attempt
// answered 500 with "No number after minus sign in JSON" — the multipart
// boundary parsed as JSON (F-111).
const MAX_FILES = 20;
const MAX_BYTES = 4 * 1024 * 1024 * 1024;
const SAFE_NAME = /[^A-Za-z0-9._-]+/g;

function safeFileName(name: string, index: number): string {
  const base = (name.split(/[/\\]/).pop() ?? '').trim();
  const cleaned = base.replace(SAFE_NAME, '-').replace(/^[.-]+/, '');
  if (cleaned !== '' && cleaned !== extname(cleaned)) return cleaned.slice(0, 180);
  return `upload-${Date.now()}-${index}${extname(base) || '.bin'}`;
}

async function importUploads(request: Request): Promise<Response> {
  const form = await request.formData();
  const files = form.getAll('files').filter((value): value is File => value instanceof File);
  if (files.length === 0) throw new KilnryError('INVALID_INPUT', 'No files were uploaded.');
  if (files.length > MAX_FILES)
    throw new KilnryError('INVALID_INPUT', `Up to ${MAX_FILES} files can be imported at once.`);
  const folderValue = form.get('target_folder');
  const folder = typeof folderValue === 'string' && folderValue.trim() !== '' ? folderValue : 'inbox';
  const config = loadConfig();
  if (!config.library_root) throw new KilnryError('NOT_FOUND', 'Library root is not configured.');
  const services = await runtimeServices();
  const marker = await libraryMarker(config.library_root);
  const assets: Array<{ asset_id: string; path: string }> = [];
  for (const [index, file] of files.entries()) {
    if (file.size > MAX_BYTES) throw new KilnryError('INVALID_INPUT', `${file.name} is larger than 4 GB.`);
    // Every write goes through the containment check, so a crafted
    // target_folder or file name cannot leave the Library (TRD-15 §11).
    const target = await resolveInRoot(config.library_root, join(folder, safeFileName(file.name, index)), {
      mustExist: false,
    });
    await mkdir(dirname(target.abs), { recursive: true });
    await writeFile(target.abs, Buffer.from(await file.arrayBuffer()), { flag: 'w' });
    const indexed = await indexAsset(services.database, config.library_root, target.abs, marker.library_id);
    assets.push({ asset_id: indexed.sidecar.asset_id, path: target.rel });
  }
  return NextResponse.json({
    assets,
    report: { scanned: assets.length, imported: assets.length, recovered: 0, errors: [] },
  });
}

export async function POST(request: Request): Promise<Response> {
  try {
    await requireSession();
    if ((request.headers.get('content-type') ?? '').includes('multipart/form-data')) {
      return await importUploads(request);
    }
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

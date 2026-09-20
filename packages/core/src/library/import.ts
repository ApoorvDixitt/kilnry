// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { opendir, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { createDerivatives } from '@kilnry/media';
import type { DatabaseState } from '@kilnry/db';
import { resolveInRoot } from './containment.js';
import { indexAsset } from './index.js';
import { safeFetch } from '../security/ssrf.js';

export interface ImportReport {
  scanned: number;
  imported: number;
  recovered: number;
  errors: Array<{ path: string; message: string }>;
}

async function walkMedia(directory: string): Promise<string[]> {
  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const handle = await opendir(dir);
    for await (const entry of handle) {
      if (entry.name.startsWith('.') || entry.name === 'Trash') continue;
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await walk(path);
      else if (
        !entry.name.endsWith('.kilnry.json') &&
        !/\.(?:part|crdownload|download|tmp-[^/]+)$/.test(entry.name)
      ) {
        files.push(path);
      }
    }
  };
  await walk(directory);
  return files.sort((left, right) => left.localeCompare(right));
}

// Import an existing folder that already lives inside the Library root: probe,
// hash, thumbnail and write a sidecar for each media file in place, without
// moving or altering the bytes. Duplicates and already-indexed files are handled
// by indexAsset's sha256 reconciliation. Nothing outside the root is touched.
export async function importFolder(
  state: DatabaseState,
  root: string,
  libraryId: string,
  folderRel: string,
  options: {
    dataDir?: string;
    onProgress?: (done: number, total: number) => void;
  } = {},
): Promise<ImportReport> {
  const target = folderRel ? await resolveInRoot(root, folderRel, { mustExist: true }) : { abs: root };
  const files = await walkMedia(target.abs);
  let imported = 0;
  let recovered = 0;
  const errors: ImportReport['errors'] = [];

  for (const file of files) {
    try {
      const result = await indexAsset(state, root, file, libraryId);
      if (options.dataDir) {
        await createDerivatives({
          source: file,
          dataDir: options.dataDir,
          assetId: result.sidecar.asset_id,
          mime: result.sidecar.file.mime,
          ...(result.sidecar.file.duration_s === undefined
            ? {}
            : { durationS: result.sidecar.file.duration_s }),
        });
      }
      imported += 1;
      if (result.recovered) recovered += 1;
    } catch (error) {
      errors.push({
        path: relative(root, file),
        message: error instanceof Error ? error.message : String(error),
      });
    }
    options.onProgress?.(imported + errors.length, files.length);
  }

  return { scanned: files.length, imported, recovered, errors };
}

// The result of importing a list of sources (kilnry_import, F-ONB-07): the
// assets that landed and a per-source error list.
export interface ImportSourcesResult {
  assets: Array<{ source: string; asset_id: string; path: string; type: string }>;
  errors: Array<{ source: string; code: string; message: string }>;
}

// A safe file name derived from a URL path or an absolute path.
function importName(source: string): string {
  try {
    if (/^https?:\/\//i.test(source)) {
      const name = basename(new URL(source).pathname) || 'import';
      return name.replace(/[^\w.-]/g, '_');
    }
  } catch {
    // Fall through to the path form.
  }
  return basename(source).replace(/[^\w.-]/g, '_') || 'import';
}

// Import each source into the target folder under the Library root. An https URL
// is fetched through the SSRF-guarded fetch and written into the folder; an
// absolute path is copied in. Every file is then indexed with a sidecar. Errors
// are collected per source rather than aborting the whole call.
export async function importSources(
  state: DatabaseState,
  root: string,
  libraryId: string,
  input: {
    sources: string[];
    targetFolder?: string;
    dataDir?: string;
    fetchImpl?: typeof safeFetch;
  },
): Promise<ImportSourcesResult> {
  const fetchImpl = input.fetchImpl ?? safeFetch;
  const folderRel = input.targetFolder ?? 'inbox';
  const target = await resolveInRoot(root, folderRel, { mustExist: false });
  await mkdir(target.abs, { recursive: true, mode: 0o700 });

  const result: ImportSourcesResult = { assets: [], errors: [] };
  for (const source of input.sources) {
    try {
      const dest = join(target.abs, importName(source));
      if (/^https?:\/\//i.test(source)) {
        const response = await fetchImpl(source);
        if (!response.ok) throw new Error(`The source returned HTTP ${response.status}.`);
        const bytes = Buffer.from(await response.arrayBuffer());
        await writeFile(dest, bytes, { mode: 0o600 });
      } else if (source.startsWith('/')) {
        await copyFile(source, dest);
      } else {
        result.errors.push({
          source,
          code: 'INVALID_INPUT',
          message: 'A source must be an https URL or an absolute path.',
        });
        continue;
      }
      const indexed = await indexAsset(state, root, relative(root, dest), libraryId);
      if (input.dataDir) {
        await createDerivatives({
          source: dest,
          dataDir: input.dataDir,
          assetId: indexed.sidecar.asset_id,
          mime: indexed.sidecar.file.mime,
          ...(indexed.sidecar.file.duration_s === undefined
            ? {}
            : { durationS: indexed.sidecar.file.duration_s }),
        });
      }
      result.assets.push({
        source,
        asset_id: indexed.sidecar.asset_id,
        path: relative(root, dest),
        type: indexed.sidecar.kind,
      });
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error ? String(error.code) : 'PROVIDER_ERROR';
      result.errors.push({
        source,
        code,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { opendir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createDerivatives } from '@kilnry/media';
import type { DatabaseState } from '@kilnry/db';
import { resolveInRoot } from './containment.js';
import { indexAsset } from './index.js';

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

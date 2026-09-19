// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { opendir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { DatabaseState } from '@kilnry/db';
import { assetCharacters, assetLineage, assets, assetTags, folders } from '@kilnry/db';
import { createDerivatives } from '@kilnry/media';
import { indexAsset } from './index.js';

async function mediaFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    const handle = await opendir(directory);
    for await (const entry of handle) {
      if (entry.name.startsWith('.') || entry.name === 'Trash') continue;
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await walk(path);
      else if (
        !entry.name.endsWith('.kilnry.json') &&
        !/\.(?:part|crdownload|download|tmp-[^/]+)$/.test(entry.name)
      )
        files.push(path);
    }
  };
  await walk(root);
  return files.sort((left, right) => left.localeCompare(right));
}

export interface ReindexReport {
  scanned: number;
  indexed: number;
  recovered_from_embedded: number;
  skipped: number;
  errors: Array<{ path: string; message: string }>;
  duration_ms: number;
}

export async function reindexLibrary(
  state: DatabaseState,
  root: string,
  libraryId: string,
  options: {
    reportDir?: string;
    dataDir?: string;
    onProgress?: (done: number, total: number) => void;
  } = {},
): Promise<ReindexReport> {
  const started = Date.now();
  await state.ready;
  const files = await mediaFiles(root);
  await state.db.transaction(async (transaction) => {
    await transaction.delete(assetCharacters);
    await transaction.delete(assetLineage);
    await transaction.delete(assetTags);
    await transaction.delete(assets);
    await transaction.delete(folders);
  });
  let indexed = 0;
  let recovered = 0;
  const errors: ReindexReport['errors'] = [];
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
      indexed += 1;
      if (result.recovered) recovered += 1;
    } catch (error) {
      errors.push({
        path: relative(root, file),
        message: error instanceof Error ? error.message : String(error),
      });
    }
    options.onProgress?.(indexed + errors.length, files.length);
  }
  const report: ReindexReport = {
    scanned: files.length,
    indexed,
    recovered_from_embedded: recovered,
    skipped: files.length - indexed,
    errors,
    duration_ms: Date.now() - started,
  };
  if (options.reportDir) {
    await mkdir(options.reportDir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(options.reportDir, `reindex-${new Date().toISOString().replace(/[:.]/g, '-')}.json`),
      `${JSON.stringify(report, null, 2)}\n`,
      { mode: 0o600 },
    );
  }
  return report;
}

export async function libraryMarker(root: string): Promise<{ library_id: string }> {
  const value = JSON.parse(await readFile(join(root, '.kilnry', 'library.json'), 'utf8')) as unknown;
  if (
    typeof value !== 'object' ||
    value === null ||
    !('library_id' in value) ||
    typeof value.library_id !== 'string'
  ) {
    throw new Error('Library marker is missing a library_id.');
  }
  return { library_id: value.library_id };
}

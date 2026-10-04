// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Wires the character export/import bundle builder (F-CHR-14) to a system zip /
// unzip and to indexAsset. The builder lives in core; this supplies the pieces
// that need a shell and the Library root.

import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  appVersion,
  indexAsset,
  libraryMarker,
  loadConfig,
  type CharacterBundleServices,
} from '@kilnry/core';
import { runtimeServices } from './runtime';

function zipDir(dir: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const zipPath = `${dir}.zip`;
    const child = spawn('zip', ['-r', '-q', zipPath, '.'], { cwd: dir });
    child.on('error', () => resolve(undefined));
    child.on('close', (code) => resolve(code === 0 ? zipPath : undefined));
  });
}

function unzipTo(zipPath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('unzip', ['-q', '-o', zipPath, '-d', destDir]);
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`unzip exited ${String(code)}`))));
  });
}

export async function characterBundleServices(): Promise<CharacterBundleServices> {
  const services = await runtimeServices();
  const config = loadConfig();
  const libraryRoot = config.library_root;
  if (!libraryRoot) throw new Error('The Library root is not configured.');
  const marker = await libraryMarker(libraryRoot);
  // Stage and extract under the data dir (not watched), write the finished zip
  // to the Library's Exports folder (F-CHR-14 review items 2/7).
  const bundlesRoot = join(config.data_dir, 'bundles');
  const exportsRoot = join(libraryRoot, 'Exports');
  await mkdir(bundlesRoot, { recursive: true });
  return {
    db: services.database,
    libraryRoot,
    bundlesRoot,
    exportsRoot,
    kilnryVersion: appVersion(),
    zipDir,
    unzipTo,
    indexAsset: async (relativePath) => {
      const indexed = await indexAsset(
        services.database,
        libraryRoot,
        join(libraryRoot, relativePath),
        marker.library_id,
      );
      return indexed.sidecar.asset_id;
    },
  };
}

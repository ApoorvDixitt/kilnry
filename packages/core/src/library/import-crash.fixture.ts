// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The child process import-crash.test.ts SIGKILLs. `import` indexes a folder of
// PNGs one by one exactly as the watcher's import_path job does (indexAsset
// under the per-path lock) and prints each one; `resume` reopens the same
// database and Library, imports the folder again, and prints what it found.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assets, closeDatabaseState, createDatabase } from '@kilnry/db';
import { importFolder } from './import.js';
import { indexAsset } from './index.js';
import { withPathLock } from './locks.js';
import { prepareLibraryRoot } from './root.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
export const CRASH_FILES = 40;

async function main(): Promise<void> {
  const [phase, root] = process.argv.slice(2);
  if (!root || !['import', 'resume'].includes(phase ?? '')) throw new Error('phase and root are required');
  const dataDir = join(root, 'data');
  const library = join(root, 'library');
  mkdirSync(dataDir, { recursive: true });
  const prepared = prepareLibraryRoot(library, dataDir);
  const state = createDatabase(dataDir);
  await state.ready;
  const folder = join(library, 'Renders');
  if (phase === 'import') {
    mkdirSync(folder, { recursive: true });
    const paths: string[] = [];
    for (let index = 0; index < CRASH_FILES; index += 1) {
      const path = join(folder, `render_${String(index).padStart(2, '0')}.png`);
      writeFileSync(path, Buffer.concat([PNG, Buffer.from(`crash-${index}`)]));
      paths.push(path);
    }
    for (const [index, path] of paths.entries()) {
      await withPathLock(path, () => indexAsset(state, library, path, prepared.marker.library_id));
      process.stdout.write(`INDEXED ${index + 1}\n`);
    }
    process.stdout.write('DONE\n');
    // Stay alive until the test kills this process.
    setInterval(() => {}, 1000);
    return;
  }
  const report = await importFolder(state, library, prepared.marker.library_id, 'Renders');
  const rows = await state.db.select({ id: assets.id, path: assets.path }).from(assets);
  // The in-process lock starts empty in a new process: a lock on any path is
  // granted at once.
  const lockFree = await Promise.race([
    withPathLock(join(folder, 'render_00.png'), async () => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2000)),
  ]);
  process.stdout.write(`RESULT ${JSON.stringify({ report, rows, lockFree })}\n`);
  await closeDatabaseState(state);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDatabaseState, createDatabase } from '@kilnry/db';
import { prepareLibraryRoot } from './root.js';
import { importFolder } from './import.js';
import { listAssets } from './assets.js';
import { sidecarPath } from './sidecar.js';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose();
});

async function setup(): Promise<{
  state: Awaited<ReturnType<typeof createDatabase>>;
  library: string;
  libraryId: string;
}> {
  const rootDir = mkdtempSync(join(tmpdir(), 'kilnry-import-'));
  const dataDir = join(rootDir, 'data');
  const library = join(rootDir, 'library');
  mkdirSync(dataDir);
  const prepared = prepareLibraryRoot(library, dataDir);
  const state = createDatabase(dataDir, { memory: true });
  disposers.push(async () => {
    await closeDatabaseState(state);
    rmSync(rootDir, { recursive: true, force: true });
  });
  await state.ready;
  return { state, library, libraryId: prepared.marker.library_id };
}

describe('importFolder', () => {
  it('indexes media in place, writes sidecars, and leaves bytes unchanged', async () => {
    const { state, library, libraryId } = await setup();
    mkdirSync(join(library, 'Legacy'));
    const fileA = join(library, 'Legacy', 'one.png');
    const fileB = join(library, 'Legacy', 'two.png');
    writeFileSync(fileA, Buffer.from(PNG, 'base64'));
    writeFileSync(fileB, Buffer.from(PNG, 'base64'));
    const beforeSize = statSync(fileA).size;

    const report = await importFolder(state, library, libraryId, 'Legacy');
    expect(report.scanned).toBe(2);
    expect(report.imported).toBe(2);
    expect(statSync(fileA).size).toBe(beforeSize);
    // Sidecars exist beside each file.
    expect(() => readFileSync(sidecarPath(fileA), 'utf8')).not.toThrow();
    expect(() => readFileSync(sidecarPath(fileB), 'utf8')).not.toThrow();
    const list = await listAssets(state, { folder: 'Legacy' });
    expect(list).toHaveLength(2);
  });

  it('reports progress and refuses a folder outside the root', async () => {
    const { state, library, libraryId } = await setup();
    mkdirSync(join(library, 'Legacy'));
    writeFileSync(join(library, 'Legacy', 'one.png'), Buffer.from(PNG, 'base64'));
    const progress: Array<[number, number]> = [];
    await importFolder(state, library, libraryId, 'Legacy', {
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(progress.at(-1)).toEqual([1, 1]);
    await expect(importFolder(state, library, libraryId, '../escape')).rejects.toThrow(
      /outside the Library/i,
    );
  });
});

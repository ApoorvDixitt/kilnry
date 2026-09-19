// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assets, closeDatabaseState, createDatabase } from '@kilnry/db';
import { prepareLibraryRoot } from './root.js';
import { readSidecar, writeSidecar } from './sidecar.js';
import { watchLibrary } from './watcher.js';

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose();
});

describe('Library watcher', () => {
  it('indexes a stable file in place and reports its real folder', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kilnry-watcher-'));
    const dataDir = join(root, 'data');
    const library = join(root, 'library');
    mkdirSync(dataDir);
    const prepared = prepareLibraryRoot(library, dataDir);
    const state = createDatabase(dataDir, { memory: true });
    await state.ready;
    let importedResolve!: (value: { id: string; folder: string }) => void;
    const imported = new Promise<{ id: string; folder: string }>((resolve) => {
      importedResolve = resolve;
    });
    const errors: unknown[] = [];
    const watcher = watchLibrary({
      state,
      root: library,
      libraryId: prepared.marker.library_id,
      dataDir,
      stabilityThresholdMs: 100,
      debounceMs: 25,
      onImported: (id, folder) => importedResolve({ id, folder }),
      onError: (error) => errors.push(error),
    });
    disposers.push(async () => {
      await watcher.close();
      await closeDatabaseState(state);
      rmSync(root, { recursive: true, force: true });
    });
    await watcher.ready;
    writeFileSync(
      join(library, 'inbox', 'watched.png'),
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      ),
    );
    const event = await new Promise<{ id: string; folder: string }>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Watcher did not import within 15 seconds.')),
        15_000,
      );
      void imported.then((value) => {
        clearTimeout(timeout);
        resolve(value);
      }, reject);
    });
    expect(event.folder).toBe('inbox');
    expect(await state.db.select().from(assets)).toMatchObject([{ id: event.id, path: 'inbox/watched.png' }]);
    expect(existsSync(join(dataDir, 'cache', 'thumbs', `${event.id}.webp`))).toBe(true);
    renameSync(join(library, 'inbox', 'watched.png'), join(library, 'inbox', 'renamed.png'));
    await expect
      .poll(async () => (await state.db.select().from(assets))[0]?.path, { timeout: 15_000 })
      .toBe('inbox/renamed.png');
    expect(existsSync(join(library, 'inbox', 'renamed.png.kilnry.json'))).toBe(true);
    expect(existsSync(join(library, 'inbox', 'watched.png.kilnry.json'))).toBe(false);
    expect((await state.db.select().from(assets))[0]?.id).toBe(event.id);
    const renamed = join(library, 'inbox', 'renamed.png');
    const sidecar = await readSidecar(renamed);
    if (!sidecar.ok) throw new Error(`Expected renamed sidecar, got ${sidecar.reason}.`);
    sidecar.value.generation = { prompt: 'edited outside Kilnry', seed: 42 };
    await writeSidecar(renamed, sidecar.value);
    await expect
      .poll(async () => (await state.db.select().from(assets))[0]?.prompt, { timeout: 15_000 })
      .toBe('edited outside Kilnry');
    expect((await state.db.select().from(assets))[0]?.seed).toBe(42);
    expect(errors).toEqual([]);
  }, 30_000);

  it('indexes files even when the Library root lives under a dot-directory', async () => {
    // Regression for F-LIB-04: the ignore rule must run relative to the root, so
    // a root whose own prefix contains a dot segment (for example a hidden home
    // folder or a temporary .dev path) does not have every file ignored.
    const base = mkdtempSync(join(tmpdir(), 'kilnry-watcher-dot-'));
    const dataDir = join(base, 'data');
    const library = join(base, '.hidden', 'library');
    mkdirSync(dataDir, { recursive: true });
    const prepared = prepareLibraryRoot(library, dataDir);
    const state = createDatabase(dataDir, { memory: true });
    await state.ready;
    let importedResolve!: (value: { id: string; folder: string }) => void;
    const imported = new Promise<{ id: string; folder: string }>((resolve) => {
      importedResolve = resolve;
    });
    const watcher = watchLibrary({
      state,
      root: library,
      libraryId: prepared.marker.library_id,
      dataDir,
      stabilityThresholdMs: 100,
      debounceMs: 25,
      onImported: (id, folder) => importedResolve({ id, folder }),
      onError: () => {},
    });
    disposers.push(async () => {
      await watcher.close();
      await closeDatabaseState(state);
      rmSync(base, { recursive: true, force: true });
    });
    await watcher.ready;
    writeFileSync(
      join(library, 'inbox', 'watched.png'),
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      ),
    );
    const event = await new Promise<{ id: string; folder: string }>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Watcher did not import within 15 seconds.')),
        15_000,
      );
      void imported.then((value) => {
        clearTimeout(timeout);
        resolve(value);
      }, reject);
    });
    expect(event.folder).toBe('inbox');
    expect(existsSync(join(library, 'inbox', 'watched.png.kilnry.json'))).toBe(true);
  }, 30_000);
});

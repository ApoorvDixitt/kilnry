// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDatabaseState, createDatabase } from '@kilnry/db';
import { prepareLibraryRoot } from './root.js';
import { importFolder, importFromPath } from './import.js';
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

// F-125: PRD-06 §2 — "Default is in-place when the source is already inside the
// Library root; otherwise copy into the chosen folder (`inbox/` default) unless
// `--move`." The Library could only re-index a folder it already had.
describe('importFromPath (F-ONB-07, F-125)', () => {
  // Distinct bytes per file: a PNG with a different trailing comment chunk.
  const png = (n: number): Buffer => Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.from(`kilnry-${n}`)]);

  function outside(files: Record<string, Buffer>): string {
    const dir = mkdtempSync(join(tmpdir(), 'kilnry-renders-'));
    disposers.push(async () => rmSync(dir, { recursive: true, force: true }));
    for (const [rel, bytes] of Object.entries(files)) {
      mkdirSync(join(dir, rel, '..'), { recursive: true });
      writeFileSync(join(dir, rel), bytes);
    }
    return dir;
  }

  it('copies a folder from outside the Library into inbox/<name>, keeping subfolders and the originals', async () => {
    const { state, library, libraryId } = await setup();
    const source = outside({ 'one.png': png(1), 'shots/two.png': png(2) });
    const report = await importFromPath(state, library, libraryId, { source });
    const name = source.split('/').at(-1)!;
    expect(report).toMatchObject({
      mode: 'copy',
      destination: `inbox/${name}`,
      scanned: 2,
      imported: 2,
      duplicates: 0,
    });
    expect(existsSync(join(library, 'inbox', name, 'one.png'))).toBe(true);
    expect(existsSync(join(library, 'inbox', name, 'shots', 'two.png'))).toBe(true);
    expect(existsSync(join(source, 'one.png'))).toBe(true);
    const listed = await listAssets(state, { folder: `inbox/${name}` });
    expect(listed.length).toBeGreaterThan(0);
  });

  it('moves when asked, skips files already in the Library, and never follows a link', async () => {
    const { state, library, libraryId } = await setup();
    const first = outside({ 'a.png': png(3) });
    await importFromPath(state, library, libraryId, { source: first, into: 'Client_A' });
    const second = outside({ 'a-again.png': png(3), 'b.png': png(4) });
    symlinkSync(join(first, 'a.png'), join(second, 'link.png'));
    const report = await importFromPath(state, library, libraryId, {
      source: second,
      into: 'Client_A',
      mode: 'move',
    });
    expect(report).toMatchObject({ mode: 'move', imported: 1, duplicates: 1, scanned: 2 });
    expect(existsSync(join(second, 'b.png'))).toBe(false);
    expect(existsSync(join(second, 'a-again.png'))).toBe(true);
  });

  it('indexes in place when the folder is already inside the Library', async () => {
    const { state, library, libraryId } = await setup();
    mkdirSync(join(library, 'Legacy'));
    writeFileSync(join(library, 'Legacy', 'one.png'), png(5));
    const report = await importFromPath(state, library, libraryId, { source: join(library, 'Legacy') });
    expect(report).toMatchObject({ mode: 'in_place', destination: 'Legacy', imported: 1 });
    expect(existsSync(join(library, 'inbox', 'Legacy'))).toBe(false);
  });

  it('refuses a relative path and a path that is not a folder', async () => {
    const { state, library, libraryId } = await setup();
    await expect(importFromPath(state, library, libraryId, { source: 'renders' })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    await expect(
      importFromPath(state, library, libraryId, { source: '/no/such/folder' }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { mkdtempSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assets, closeDatabaseState, createDatabase } from '@kilnry/db';
import { embedMetadata } from '@kilnry/media';
import { prepareLibraryRoot } from './root.js';
import { buildMinimalSidecar, indexAsset } from './index.js';
import { libraryMarker, reindexLibrary } from './reindex.js';
import { sidecarPath, writeSidecar } from './sidecar.js';

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose();
});

async function image(path: string): Promise<void> {
  writeFileSync(
    path,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  );
}

function stableRows(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows
    .map((row) => {
      const copy = { ...row };
      Reflect.deleteProperty(copy, 'indexedAt');
      return copy;
    })
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

describe('Library reindex', () => {
  it('rebuilds identical asset rows from sidecars', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kilnry-reindex-'));
    const dataDir = join(root, 'data');
    const library = join(root, 'library');
    mkdirSync(dataDir);
    const prepared = prepareLibraryRoot(library, dataDir);
    const state = createDatabase(dataDir, { memory: true });
    disposers.push(async () => {
      await closeDatabaseState(state);
      rmSync(root, { recursive: true, force: true });
    });
    await state.ready;
    const file = join(library, 'inbox', 'asset.png');
    await image(file);
    const sidecar = await buildMinimalSidecar({ path: file, libraryId: prepared.marker.library_id });
    await writeSidecar(file, sidecar);
    await indexAsset(state, library, file, prepared.marker.library_id);
    const before = stableRows(
      (await state.db.select().from(assets)) as unknown as Array<Record<string, unknown>>,
    );
    const report = await reindexLibrary(state, library, prepared.marker.library_id);
    const after = stableRows(
      (await state.db.select().from(assets)) as unknown as Array<Record<string, unknown>>,
    );
    expect(report).toMatchObject({ scanned: 1, indexed: 1, skipped: 0 });
    expect(after).toEqual(before);
  });

  it('recovers a missing sidecar from embedded PNG metadata with the same asset id', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kilnry-recovery-'));
    const dataDir = join(root, 'data');
    const library = join(root, 'library');
    mkdirSync(dataDir);
    const prepared = prepareLibraryRoot(library, dataDir);
    const state = createDatabase(dataDir, { memory: true });
    disposers.push(async () => {
      await closeDatabaseState(state);
      rmSync(root, { recursive: true, force: true });
    });
    await state.ready;
    const file = join(library, 'inbox', 'recover.png');
    await image(file);
    const sidecar = await buildMinimalSidecar({ path: file, libraryId: prepared.marker.library_id });
    sidecar.generation = { prompt: 'recover me', provider: 'fal', model: 'fixture/model' };
    await writeSidecar(file, sidecar);
    await embedMetadata(file, 'image/png', {
      kilnry: 1,
      asset_id: sidecar.asset_id,
      library_id: sidecar.library_id,
      created_at: sidecar.created_at,
      source: sidecar.source,
      kind: sidecar.kind,
      generation: sidecar.generation,
      lineage: sidecar.lineage,
    });
    unlinkSync(sidecarPath(file));
    const marker = await libraryMarker(library);
    const report = await reindexLibrary(state, library, marker.library_id);
    const rows = await state.db.select().from(assets);
    expect(report.recovered_from_embedded).toBe(1);
    expect(rows[0]).toMatchObject({ id: sidecar.asset_id, prompt: 'recover me', sidecarOk: true });
  });
});

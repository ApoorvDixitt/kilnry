// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assets, closeDatabaseState, createDatabase } from '@kilnry/db';
import { prepareLibraryRoot } from './root.js';
import { indexAsset } from './index.js';
import { withPathLock } from './locks.js';

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose();
});

function image(path: string): void {
  writeFileSync(
    path,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  );
}

describe('withPathLock', () => {
  it('serializes callers on the same path so concurrent indexers do not collide', async () => {
    // This is the F-LIB-04 race: before withPathLock the drive and the watcher
    // each read "no sidecar", minted a different ULID for the same file and
    // upserted on-conflict-(id); the ids differed so the second violated the
    // unique `path` ("burn: Failed query: insert into assets …" on CI).
    const root = mkdtempSync(join(tmpdir(), 'kilnry-locks-'));
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
    image(file);

    const [a, b] = await Promise.all([
      indexAsset(state, library, file, prepared.marker.library_id),
      indexAsset(state, library, file, prepared.marker.library_id),
    ]);

    expect(a.sidecar.asset_id).toBe(b.sidecar.asset_id);
    const rows = await state.db.select().from(assets);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.path).toBe('inbox/asset.png');
  }, 20_000);

  it('runs calls on different paths without blocking each other', async () => {
    const order: string[] = [];
    const slow = withPathLock('/a', async () => {
      await new Promise((r) => setTimeout(r, 40));
      order.push('a');
    });
    const fast = withPathLock('/b', async () => {
      order.push('b');
    });
    await Promise.all([slow, fast]);
    expect(order).toEqual(['b', 'a']);
  });
});

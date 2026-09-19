// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assets, closeDatabaseState, createDatabase } from '@kilnry/db';
import { eq } from 'drizzle-orm';
import { prepareLibraryRoot } from './root.js';
import { buildMinimalSidecar, indexAsset } from './index.js';
import { deleteAssetToTrash, listAssets, restoreAsset, updateAssetMetadata } from './assets.js';
import { sidecarPath, writeSidecar } from './sidecar.js';

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose();
});

async function setup(): Promise<{
  state: Awaited<ReturnType<typeof createDatabase>>;
  library: string;
  libraryId: string;
  file: string;
  assetId: string;
}> {
  const root = mkdtempSync(join(tmpdir(), 'kilnry-meta-'));
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
  writeFileSync(
    file,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  );
  const sidecar = await buildMinimalSidecar({ path: file, libraryId: prepared.marker.library_id });
  await writeSidecar(file, sidecar);
  await indexAsset(state, library, file, prepared.marker.library_id);
  const [row] = await state.db.select().from(assets).where(eq(assets.path, 'inbox/asset.png')).limit(1);
  return { state, library, libraryId: prepared.marker.library_id, file, assetId: row!.id };
}

describe('updateAssetMetadata', () => {
  it('writes tags, label, rating and notes to the sidecar and reindexes', async () => {
    const { state, library, libraryId, file, assetId } = await setup();
    await updateAssetMetadata(state, library, libraryId, assetId, {
      tags: ['hero', 'serum'],
      label: 'green',
      rating: 4,
      user_notes: 'client pick',
    });
    const sidecar = JSON.parse(readFileSync(sidecarPath(file), 'utf8')) as Record<string, unknown>;
    expect(sidecar).toMatchObject({
      tags: ['hero', 'serum'],
      label: 'green',
      rating: 4,
      user_notes: 'client pick',
    });
    const [row] = await state.db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
    expect(row).toMatchObject({ label: 'green', rating: 4, userNotes: 'client pick' });
  });

  it('rejects an invalid tag', async () => {
    const { state, library, libraryId, assetId } = await setup();
    await expect(
      updateAssetMetadata(state, library, libraryId, assetId, { tags: ['Bad Tag!'] }),
    ).rejects.toThrow(/not allowed/);
  });

  it('accepts a prompt for an imported asset without a recipe', async () => {
    const { state, library, libraryId, file, assetId } = await setup();
    await updateAssetMetadata(state, library, libraryId, assetId, { prompt: 'a paper crane' });
    const sidecar = JSON.parse(readFileSync(sidecarPath(file), 'utf8')) as {
      generation?: { prompt?: string; source?: string };
    };
    expect(sidecar.generation).toMatchObject({ prompt: 'a paper crane', source: 'import' });
  });

  it('surfaces the edited fields through listAssets', async () => {
    const { state, library, libraryId, assetId } = await setup();
    await updateAssetMetadata(state, library, libraryId, assetId, { rating: 5 });
    const list = await listAssets(state, { folder: 'inbox' });
    expect(list.find((item) => item.id === assetId)).toBeDefined();
  });
});

describe('trash', () => {
  it('moves an asset and its sidecar to Trash and stamps the sidecar', async () => {
    const { state, library, libraryId, assetId } = await setup();
    await deleteAssetToTrash(state, library, libraryId, assetId);
    const inbox = await listAssets(state, { folder: 'inbox' });
    expect(inbox.find((item) => item.id === assetId)).toBeUndefined();
    const [row] = await state.db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
    expect(row!.trashedAt).not.toBeNull();
    expect(row!.originalPath).toBe('inbox/asset.png');
    expect(existsSync(join(library, row!.path))).toBe(true);
    const sidecar = JSON.parse(readFileSync(join(library, `${row!.path}.kilnry.json`), 'utf8')) as {
      trash?: { original_path?: string };
    };
    expect(sidecar.trash?.original_path).toBe('inbox/asset.png');
  });

  it('restores a trashed asset to its original path', async () => {
    const { state, library, libraryId, assetId } = await setup();
    await deleteAssetToTrash(state, library, libraryId, assetId);
    await restoreAsset(state, library, assetId);
    const [row] = await state.db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
    expect(row!.path).toBe('inbox/asset.png');
    expect(row!.trashedAt).toBeNull();
    expect(existsSync(join(library, 'inbox', 'asset.png'))).toBe(true);
  });
});

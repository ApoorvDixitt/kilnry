// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeDatabaseState, createDatabase, assets, assetLineage } from '@kilnry/db';
import { exportBundle, type ExportOptions, type ExportServices } from './export-bundle.js';
import { ulid } from '../ids.js';

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose();
});

async function harness(): Promise<{
  state: Awaited<ReturnType<typeof createDatabase>>;
  libraryRoot: string;
  exportsRoot: string;
}> {
  const root = mkdtempSync(join(tmpdir(), 'kilnry-export-'));
  const state = createDatabase(join(root, 'data'), { memory: true });
  const libraryRoot = join(root, 'library');
  const exportsRoot = join(root, 'exports');
  mkdirSync(libraryRoot, { recursive: true });
  disposers.push(async () => {
    await closeDatabaseState(state);
    rmSync(root, { recursive: true, force: true });
  });
  await state.ready;
  return { state, libraryRoot, exportsRoot };
}

async function seedAsset(
  state: Awaited<ReturnType<typeof createDatabase>>,
  libraryRoot: string,
  name: string,
  bytes: string,
): Promise<string> {
  const id = ulid();
  writeFileSync(join(libraryRoot, name), bytes);
  writeFileSync(join(libraryRoot, `${name}.kilnry.json`), JSON.stringify({ asset_id: id }));
  await state.db.insert(assets).values({
    id,
    libraryId: 'L'.padEnd(26, '0'),
    path: name,
    kind: 'image',
    mime: 'image/png',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    createdAt: new Date(),
  } as never);
  return id;
}

async function linkLineage(
  state: Awaited<ReturnType<typeof createDatabase>>,
  childId: string,
  parentId: string,
): Promise<void> {
  await state.db.insert(assetLineage).values({ childId, parentId, role: 'made_from' } as never);
}

function options(over: Partial<ExportOptions> = {}): ExportOptions {
  return {
    asset_ids: [],
    format: 'folder',
    include_sidecars: true,
    metadata: 'keep',
    provenance: 'none',
    include_lineage: false,
    manifest: true,
    rename: false,
    ...over,
  };
}

function services(
  h: Awaited<ReturnType<typeof harness>>,
  over: Partial<ExportServices> = {},
): ExportServices {
  return {
    db: h.state,
    libraryRoot: h.libraryRoot,
    libraryId: 'L'.padEnd(26, '0'),
    exportsRoot: h.exportsRoot,
    now: () => new Date('2026-09-21T00:00:00Z'),
    ...over,
  };
}

describe('export bundle (F-LIB-14)', () => {
  it('writes each file, its sidecar and a manifest with matching sha256', async () => {
    const h = await harness();
    const id = await seedAsset(h.state, h.libraryRoot, 'hero.png', 'PNGDATA');
    const result = await exportBundle(services(h), options({ asset_ids: [id] }));
    expect(existsSync(join(result.bundle_path, 'hero.png'))).toBe(true);
    expect(existsSync(join(result.bundle_path, 'hero.png.kilnry.json'))).toBe(true);
    const manifest = JSON.parse(readFileSync(join(result.bundle_path, 'bundle.kilnry.json'), 'utf8')) as {
      assets: Array<{ asset_id: string; sha256: string }>;
    };
    expect(manifest.assets[0]?.asset_id).toBe(id);
    expect(manifest.assets[0]?.sha256).toBe(createHash('sha256').update('PNGDATA').digest('hex'));
  });

  it('strips metadata on the copy only and never touches the original', async () => {
    const h = await harness();
    const id = await seedAsset(h.state, h.libraryRoot, 'hero.png', 'PNGDATA');
    const strip = vi.fn(async () => undefined);
    const result = await exportBundle(
      services(h, { stripMetadata: strip }),
      options({ asset_ids: [id], metadata: 'strip' }),
    );
    expect(strip).toHaveBeenCalledOnce();
    // The original is unchanged.
    expect(readFileSync(join(h.libraryRoot, 'hero.png'), 'utf8')).toBe('PNGDATA');
    expect(result.entries).toHaveLength(1);
  });

  it('writes the IPTC label on the copy when the IPTC option is chosen', async () => {
    const h = await harness();
    const id = await seedAsset(h.state, h.libraryRoot, 'hero.png', 'PNGDATA');
    const label = vi.fn(async () => undefined);
    await exportBundle(services(h, { labelIptc: label }), options({ asset_ids: [id], provenance: 'iptc' }));
    expect(label).toHaveBeenCalledOnce();
  });

  it('adds lineage sources recursively when asked', async () => {
    const h = await harness();
    const source = await seedAsset(h.state, h.libraryRoot, 'src.png', 'SRC');
    const derived = await seedAsset(h.state, h.libraryRoot, 'out.png', 'OUT');
    await linkLineage(h.state, derived, source);
    const result = await exportBundle(services(h), options({ asset_ids: [derived], include_lineage: true }));
    expect(result.entries.map((entry) => entry.asset_id).sort()).toEqual([source, derived].sort());
  });

  it('renames files sequentially when asked', async () => {
    const h = await harness();
    const id = await seedAsset(h.state, h.libraryRoot, 'hero.png', 'PNGDATA');
    const result = await exportBundle(services(h), options({ asset_ids: [id], rename: true }));
    expect(result.entries[0]?.path).toMatch(/_01\.png$/);
  });
});

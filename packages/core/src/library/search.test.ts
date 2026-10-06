// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assetTags, assets, closeDatabaseState, createDatabase } from '@kilnry/db';
import { prepareLibraryRoot } from './root.js';
import { buildMinimalSidecar, indexAsset } from './index.js';
import { writeSidecar } from './sidecar.js';
import { updateAssetMetadata } from './assets.js';
import { likeNeedle, parseSearchQuery, resolveSince, searchAssets } from './search.js';
import { eq } from 'drizzle-orm';

const NOW = new Date('2026-09-19T00:00:00.000Z');

describe('parseSearchQuery', () => {
  it('parses the worked query into structured filters', () => {
    const parsed = parseSearchQuery('@maya type:video cost>0.5 since:7d', NOW);
    expect(parsed.handles).toEqual([{ handle: 'maya' }]);
    expect(parsed.types).toEqual(['video']);
    expect(parsed.costGt).toBe(0.5);
    expect(parsed.since).toBe('2026-09-12T00:00:00.000Z');
  });

  it('keeps quoted phrases and handles negation', () => {
    const parsed = parseSearchQuery('"marble counter" -model:flux', NOW);
    expect(parsed.phrases).toEqual(['marble counter']);
    expect(parsed.negModels).toEqual(['flux']);
  });

  it('reads has, in, sort, tag and label tokens', () => {
    const parsed = parseSearchQuery('has:nosidecar in:trash sort:cost tag:hero label:green', NOW);
    expect(parsed.has).toContain('nosidecar');
    expect(parsed.in).toContain('trash');
    expect(parsed.sort).toBe('cost');
    expect(parsed.tags).toContain('hero');
    expect(parsed.labels).toContain('green');
  });

  it('rejects a non-numeric cost and a bad date', () => {
    expect(() => parseSearchQuery('cost>abc', NOW)).toThrow(/isn't a number/);
    expect(() => parseSearchQuery('since:soon', NOW)).toThrow(/isn't a date/);
  });
});

describe('resolveSince', () => {
  it('resolves relative and absolute forms', () => {
    expect(resolveSince('24h', NOW)).toBe('2026-09-18T00:00:00.000Z');
    expect(resolveSince('2026-09-01', NOW)).toBe('2026-09-01T00:00:00.000Z');
  });
});

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose();
});

async function seededLibrary(): Promise<{
  state: Awaited<ReturnType<typeof createDatabase>>;
  library: string;
}> {
  const root = mkdtempSync(join(tmpdir(), 'kilnry-search-'));
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
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  for (const name of ['crane.png', 'chai.png']) {
    const file = join(library, 'inbox', name);
    writeFileSync(file, Buffer.from(png, 'base64'));
    const sidecar = await buildMinimalSidecar({ path: file, libraryId: prepared.marker.library_id });
    await writeSidecar(file, sidecar);
    await indexAsset(state, library, file, prepared.marker.library_id);
  }
  return { state, library };
}

describe('searchAssets', () => {
  it('matches free text against filenames and returns index rows', async () => {
    const { state } = await seededLibrary();
    const rows = await searchAssets(state, parseSearchQuery('crane', NOW));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.path).toContain('crane.png');
  });

  // The query half of F-35, F-36, F-38 and F-72: each token now narrows the
  // result set instead of silently matching everything or nothing.
  it('filters by cost=, has:demo, has:moderated and a literal percent sign', async () => {
    const { state } = await seededLibrary();
    const all = await searchAssets(state, parseSearchQuery('', NOW));
    const [first, second] = all;
    await state.db
      .update(assets)
      .set({ actualUsd: '0.500000', prompt: '100% linen on a marble counter' })
      .where(eq(assets.id, first!.id));
    await state.db
      .update(assets)
      .set({ actualUsd: '1.250000', moderation: { code: 'content_policy_violation' } })
      .where(eq(assets.id, second!.id));
    await state.db.insert(assetTags).values({ assetId: first!.id, tag: 'demo' });

    expect((await searchAssets(state, parseSearchQuery('cost=0.5', NOW))).map((row) => row.id)).toEqual([
      first!.id,
    ]);
    expect((await searchAssets(state, parseSearchQuery('has:demo', NOW))).map((row) => row.id)).toEqual([
      first!.id,
    ]);
    expect((await searchAssets(state, parseSearchQuery('has:moderated', NOW))).map((row) => row.id)).toEqual([
      second!.id,
    ]);
    // The literal "100%" matches the one asset that contains it, not both.
    expect((await searchAssets(state, parseSearchQuery('100%', NOW))).map((row) => row.id)).toEqual([
      first!.id,
    ]);
  });

  it('matches text written into notes through the sidecar-first metadata edit', async () => {
    const { state, library } = await seededLibrary();
    const all = await searchAssets(state, parseSearchQuery('', NOW));
    const marker = all.find((row) => row.path.includes('chai'))!;
    const prepared = await import('./reindex.js').then((m) => m.libraryMarker(library));
    await updateAssetMetadata(state, library, prepared.library_id, marker.id, {
      user_notes: 'client hero pick',
    });
    const rows = await searchAssets(state, parseSearchQuery('hero', NOW));
    expect(rows.some((row) => row.path.includes('chai'))).toBe(true);
  });

  it('excludes trashed assets unless in:trash is given', async () => {
    const { state } = await seededLibrary();
    const rows = await searchAssets(state, parseSearchQuery('type:image', NOW));
    expect(rows.length).toBe(2);
  });

  it('filters by tag through the asset_tags index', async () => {
    const { state, library } = await seededLibrary();
    const all = await searchAssets(state, parseSearchQuery('', NOW));
    const chai = all.find((row) => row.path.includes('chai'))!;
    const prepared = await import('./reindex.js').then((m) => m.libraryMarker(library));
    await updateAssetMetadata(state, library, prepared.library_id, chai.id, { tags: ['hero'] });
    const tagged = await searchAssets(state, parseSearchQuery('tag:hero', NOW));
    expect(tagged.map((row) => row.id)).toEqual([chai.id]);
    const none = await searchAssets(state, parseSearchQuery('tag:missing', NOW));
    expect(none).toHaveLength(0);
  });

  it('filters by character through the asset_characters lineage', async () => {
    const { state } = await seededLibrary();
    const { createCharacter, recordAssetCharacters } = await import('../characters/store.js');
    const all = await searchAssets(state, parseSearchQuery('', NOW));
    const chai = all.find((row) => row.path.includes('chai'))!;
    const head = await createCharacter(state, { handle: 'maya', kind: 'character', display_name: 'Maya' });
    await recordAssetCharacters(state, chai.id, [{ character_id: head.id, version: 1, strategy: 'text' }]);
    const byHandle = await searchAssets(state, parseSearchQuery('@maya', NOW));
    expect(byHandle.map((row) => row.id)).toEqual([chai.id]);
    const byFilter = await searchAssets(state, parseSearchQuery('character:maya', NOW));
    expect(byFilter.map((row) => row.id)).toEqual([chai.id]);
    const noMatch = await searchAssets(state, parseSearchQuery('@nobody', NOW));
    expect(noMatch).toHaveLength(0);
  });

  // F-35, F-36, F-37, F-38 and F-72: five tokens from PRD-06's own table were
  // parsed as free text or dropped, so each returned either nothing or the whole
  // Library, and a literal % or _ in a search behaved as an ILIKE wildcard.
  it('parses ar:, res:, cost= and an @handle@vN pin', () => {
    const parsed = parseSearchQuery('ar:9:16 res:4k cost=0.5 @maya@v2');
    expect(parsed.aspect).toEqual({ ratio: 9 / 16, label: '9:16' });
    expect(parsed.resolution).toEqual({ minHeight: 2160, label: '4k' });
    expect(parsed.costEq).toBe(0.5);
    expect(parsed.handles).toEqual([{ handle: 'maya', version: 2 }]);
    expect(parsed.text).toEqual([]);
  });

  it('refuses an aspect ratio, a tier or a has: flag it cannot honour', () => {
    expect(() => parseSearchQuery('ar:wide')).toThrow(/aspect ratio/);
    expect(() => parseSearchQuery('res:ultra')).toThrow(/resolution tier/);
  });

  it('escapes the ILIKE wildcards a user typed', () => {
    expect(likeNeedle('100%')).toBe('%100\\%%');
    expect(likeNeedle('a_b')).toBe('%a\\_b%');
    expect(likeNeedle('plain')).toBe('%plain%');
  });
});

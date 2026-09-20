// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assetCharacters, assets, closeDatabaseState, createDatabase } from '@kilnry/db';
import { ulid } from '../ids.js';
import { addReferences, createCharacter } from './store.js';
import {
  cardFor,
  listCards,
  loadFullCharacter,
  mentionSuggestions,
  parseHandlePin,
  usageAssets,
} from './full.js';

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose();
});

async function db(): Promise<Awaited<ReturnType<typeof createDatabase>>> {
  const root = mkdtempSync(join(tmpdir(), 'kilnry-full-'));
  const state = createDatabase(join(root, 'data'), { memory: true });
  disposers.push(async () => {
    await closeDatabaseState(state);
    rmSync(root, { recursive: true, force: true });
  });
  await state.ready;
  return state;
}

describe('parseHandlePin', () => {
  it('reads a bare handle and a version pin', () => {
    expect(parseHandlePin('@maya')).toEqual({ handle: 'maya' });
    expect(parseHandlePin('maya@v2')).toEqual({ handle: 'maya', version: 2 });
  });
});

describe('loadFullCharacter and cards', () => {
  it('assembles a full character with references and a preview url', async () => {
    const state = await db();
    const head = await createCharacter(state, {
      handle: 'maya',
      kind: 'character',
      display_name: 'Maya',
      tags: ['role:host'],
      appearance: { descriptor: 'a woman', anchors: ['blunt fringe bob'], negative_traits: [] },
    });
    const anchor = ulid();
    await addReferences(state, head.id, [{ asset_id: anchor, role: 'anchor', view: 'front' }]);

    const full = await loadFullCharacter(state, 'maya');
    expect(full).toMatchObject({ handle: 'maya', version: 1, versions: [1], tags: ['role:host'] });
    expect(full.references[0]).toMatchObject({
      asset_id: anchor,
      role: 'anchor',
      preview_url: `/api/thumb/${anchor}`,
    });
    expect(full.injection_defaults).toEqual({ image: [], video: [], audio: [] });

    const card = await cardFor(state, head);
    expect(card).toMatchObject({
      handle: 'maya',
      anchor_asset_id: anchor,
      anchor_preview_url: `/api/thumb/${anchor}`,
      reference_count: 1,
    });
  });

  it('lists cards filtered by kind and tag', async () => {
    const state = await db();
    await createCharacter(state, {
      handle: 'maya',
      kind: 'character',
      display_name: 'Maya',
      tags: ['role:host'],
    });
    await createCharacter(state, { handle: 'chai_glass', kind: 'prop', display_name: 'Chai glass' });
    const characters = await listCards(state, { kind: 'character' });
    expect(characters.map((c) => c.handle)).toEqual(['maya']);
    const tagged = await listCards(state, { kind: 'character', tags: ['role:host'] });
    expect(tagged).toHaveLength(1);
    const none = await listCards(state, { kind: 'character', tags: ['role:hero'] });
    expect(none).toHaveLength(0);
  });

  it('suggests mentions by handle prefix', async () => {
    const state = await db();
    await createCharacter(state, { handle: 'maya', kind: 'character', display_name: 'Maya' });
    await createCharacter(state, { handle: 'mateo', kind: 'character', display_name: 'Mateo' });
    const items = await mentionSuggestions(state, 'ma', ['character']);
    expect(items.map((i) => i.handle).sort()).toEqual(['mateo', 'maya']);
  });

  it('reports usage assets newest first', async () => {
    const state = await db();
    const head = await createCharacter(state, { handle: 'maya', kind: 'character', display_name: 'Maya' });
    const assetId = ulid();
    await state.db.insert(assets).values({
      id: assetId,
      path: 'inbox/out.png',
      kind: 'image',
      createdAt: new Date(),
    });
    await state.db
      .insert(assetCharacters)
      .values({ assetId, characterId: head.id, version: 1, strategy: 'text' });
    const usage = await usageAssets(state, 'maya');
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ asset_id: assetId, preview_url: `/api/thumb/${assetId}` });
  });
});

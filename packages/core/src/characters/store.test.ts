// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { characters, closeDatabaseState, createDatabase } from '@kilnry/db';
import { eq } from 'drizzle-orm';
import { ulid } from '../ids.js';
import {
  addHandleAlias,
  addReferences,
  assetsForCharacter,
  createCharacter,
  ensureUnfrozenVersion,
  forkVersion,
  freezeVersion,
  isValidHandle,
  listVersions,
  loadVersion,
  lookupHandle,
  normaliseHandle,
  recordAssetCharacters,
  removeReference,
  setAppearance,
  setCurrentVersion,
} from './store.js';

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose();
});

async function db(): Promise<Awaited<ReturnType<typeof createDatabase>>> {
  const root = mkdtempSync(join(tmpdir(), 'kilnry-char-'));
  const state = createDatabase(join(root, 'data'), { memory: true });
  disposers.push(async () => {
    await closeDatabaseState(state);
    rmSync(root, { recursive: true, force: true });
  });
  await state.ready;
  return state;
}

describe('handle grammar', () => {
  it('accepts and normalises valid handles', () => {
    expect(normaliseHandle('@Maya')).toBe('maya');
    expect(normaliseHandle('chai_glass')).toBe('chai_glass');
    expect(isValidHandle('a2')).toBe(true);
  });

  it('rejects handles that break the grammar', () => {
    expect(isValidHandle('a')).toBe(false);
    expect(isValidHandle('has space')).toBe(false);
    expect(() => normaliseHandle('!!')).toThrow(/valid @handle/);
  });
});

describe('create and lookup', () => {
  it('creates a character with its first version and finds it by handle', async () => {
    const state = await db();
    const head = await createCharacter(state, {
      handle: '@Maya',
      kind: 'character',
      display_name: 'Maya',
      appearance: { descriptor: 'a woman', anchors: ['blunt fringe bob'], negative_traits: ['glasses'] },
    });
    expect(head).toMatchObject({ handle: 'maya', kind: 'character', current_version: 1 });
    const found = await lookupHandle(state, 'MAYA');
    expect(found?.id).toBe(head.id);
    const loaded = await loadVersion(state, head.id);
    expect(loaded.appearance.anchors).toEqual(['blunt fringe bob']);
    expect(loaded.version).toBe(1);
  });

  it('refuses a duplicate handle', async () => {
    const state = await db();
    await createCharacter(state, { handle: 'maya', kind: 'character', display_name: 'Maya' });
    await expect(
      createCharacter(state, { handle: 'maya', kind: 'character', display_name: 'Maya 2' }),
    ).rejects.toThrow(/already in use/);
  });

  it('marks a real person as consent none at creation', async () => {
    const state = await db();
    const head = await createCharacter(state, {
      handle: 'real_person',
      kind: 'character',
      display_name: 'Real Person',
      is_real_person: true,
    });
    expect(head.consent_status).toBe('none');
  });

  it('follows one alias hop when resolving a renamed handle', async () => {
    const state = await db();
    const head = await createCharacter(state, { handle: 'maya', kind: 'character', display_name: 'Maya' });
    await addHandleAlias(state, 'maya_old', head.id);
    const viaAlias = await lookupHandle(state, '@maya_old');
    expect(viaAlias?.id).toBe(head.id);
  });
});

describe('references and versioning', () => {
  it('adds ordered references to the current unfrozen version', async () => {
    const state = await db();
    const head = await createCharacter(state, { handle: 'maya', kind: 'character', display_name: 'Maya' });
    await addReferences(state, head.id, [
      { asset_id: ulid(), role: 'anchor', view: 'front' },
      { asset_id: ulid(), role: 'turnaround', view: 'three_quarter_left' },
    ]);
    const loaded = await loadVersion(state, head.id);
    expect(loaded.references).toHaveLength(2);
    expect(loaded.references[0]).toMatchObject({ role: 'anchor', view: 'front', position: 0 });
    expect(loaded.references[1]).toMatchObject({ position: 1 });
  });

  it('forks a new version when adding references to a frozen version', async () => {
    const state = await db();
    const head = await createCharacter(state, { handle: 'maya', kind: 'character', display_name: 'Maya' });
    await addReferences(state, head.id, [{ asset_id: ulid(), role: 'anchor', view: 'front' }]);
    await freezeVersion(state, head.id, 1);
    const version = await addReferences(state, head.id, [{ asset_id: ulid(), role: 'outfit', label: 'wet' }]);
    expect(version).toBe(2);
    const v2 = await loadVersion(state, head.id);
    expect(v2.version).toBe(2);
    // v2 carries the v1 anchor forward plus the new outfit reference.
    expect(v2.references).toHaveLength(2);
    const v1 = await loadVersion(state, head.id, 1);
    expect(v1.references).toHaveLength(1);
    expect(v1.frozen).toBe(true);
  });

  it('removes a reference from the current version', async () => {
    const state = await db();
    const head = await createCharacter(state, { handle: 'maya', kind: 'character', display_name: 'Maya' });
    await addReferences(state, head.id, [{ asset_id: ulid(), role: 'anchor', view: 'front' }]);
    const loaded = await loadVersion(state, head.id);
    await removeReference(state, head.id, loaded.references[0]!.id);
    const after = await loadVersion(state, head.id);
    expect(after.references).toHaveLength(0);
  });

  it('ensureUnfrozenVersion returns current when unfrozen and forks when frozen', async () => {
    const state = await db();
    const head = await createCharacter(state, { handle: 'maya', kind: 'character', display_name: 'Maya' });
    expect(await ensureUnfrozenVersion(state, head.id)).toBe(1);
    await freezeVersion(state, head.id, 1);
    expect(await ensureUnfrozenVersion(state, head.id)).toBe(2);
    expect(await forkVersion(state, head.id)).toBe(3);
  });

  it('edits a descriptor in place while the version is unfrozen', async () => {
    const state = await db();
    const head = await createCharacter(state, { handle: 'maya', kind: 'character', display_name: 'Maya' });
    const version = await setAppearance(state, head.id, { descriptor: 'A woman with a bob.' });
    expect(version).toBe(1);
    const loaded = await loadVersion(state, head.id);
    expect(loaded.appearance.descriptor).toBe('A woman with a bob.');
  });

  it('forks a new version when the descriptor of a frozen version is edited', async () => {
    const state = await db();
    const head = await createCharacter(state, { handle: 'maya', kind: 'character', display_name: 'Maya' });
    await setAppearance(state, head.id, { descriptor: 'Original.' });
    await freezeVersion(state, head.id, 1);
    const version = await setAppearance(state, head.id, { descriptor: 'Changed.' });
    expect(version).toBe(2);
    expect((await loadVersion(state, head.id)).appearance.descriptor).toBe('Changed.');
    // The frozen version keeps its original look.
    expect((await loadVersion(state, head.id, 1)).appearance.descriptor).toBe('Original.');
  });

  it('points current_version at any existing version and leaves later ones', async () => {
    const state = await db();
    const head = await createCharacter(state, { handle: 'maya', kind: 'character', display_name: 'Maya' });
    await freezeVersion(state, head.id, 1);
    await forkVersion(state, head.id);
    await setCurrentVersion(state, head.id, 1);
    const current = await loadVersion(state, head.id);
    expect(current.version).toBe(1);
    // v2 still exists and is resolvable by pin.
    expect((await loadVersion(state, head.id, 2)).version).toBe(2);
  });

  it('lists versions with their frozen flag, current marker and job count', async () => {
    const state = await db();
    const head = await createCharacter(state, { handle: 'maya', kind: 'character', display_name: 'Maya' });
    await freezeVersion(state, head.id, 1);
    await recordAssetCharacters(state, ulid(), [{ character_id: head.id, version: 1, strategy: 'text' }]);
    await forkVersion(state, head.id);
    const rows = await listVersions(state, head.id);
    expect(rows).toEqual([
      { version: 2, frozen: false, current: true, jobs: 0 },
      { version: 1, frozen: true, current: false, jobs: 1 },
    ]);
  });
});

describe('lineage', () => {
  it('records asset_characters, bumps usage, and freezes the used version', async () => {
    const state = await db();
    const head = await createCharacter(state, { handle: 'maya', kind: 'character', display_name: 'Maya' });
    const assetId = ulid();
    await recordAssetCharacters(state, assetId, [
      { character_id: head.id, version: 1, strategy: 'elements' },
      // A second occurrence of the same character maps to the same row (deduped).
      { character_id: head.id, version: 1, strategy: 'elements' },
    ]);
    const usage = await assetsForCharacter(state, head.id);
    expect(usage).toContain(assetId);
    const [row] = await state.db.select().from(characters).where(eq(characters.id, head.id)).limit(1);
    expect(row!.usageCount).toBe(1);
    expect(row!.lastUsedAt).not.toBeNull();
    const version = await loadVersion(state, head.id, 1);
    expect(version.frozen).toBe(true);
  });
});

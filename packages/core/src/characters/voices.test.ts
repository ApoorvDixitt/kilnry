// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDatabaseState, createDatabase, voices } from '@kilnry/db';
import { eq } from 'drizzle-orm';
import { ulid } from '../ids.js';
import { createCharacter } from './store.js';
import { bindPresetVoice, boundVoice, filterVoices, listVoices, presetVoices } from './voices.js';

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose();
});

async function db(): Promise<Awaited<ReturnType<typeof createDatabase>>> {
  const root = mkdtempSync(join(tmpdir(), 'kilnry-voices-'));
  const state = createDatabase(join(root, 'data'), { memory: true });
  disposers.push(async () => {
    await closeDatabaseState(state);
    rmSync(root, { recursive: true, force: true });
  });
  await state.ready;
  return state;
}

describe('presetVoices', () => {
  it('ships presets across the named providers with a price label', () => {
    const presets = presetVoices();
    expect(presets.length).toBeGreaterThan(0);
    for (const provider of ['elevenlabs', 'minimax', 'openai', 'google', 'kokoro']) {
      expect(presets.some((v) => v.provider === provider)).toBe(true);
    }
    expect(presets.every((v) => v.price_label.length > 0 && !v.is_clone)).toBe(true);
  });
});

describe('filterVoices', () => {
  it('filters by provider, language, gender and free text', () => {
    const list = presetVoices();
    expect(filterVoices(list, { provider: 'openai' }).every((v) => v.provider === 'openai')).toBe(true);
    expect(filterVoices(list, { language: 'en' }).every((v) => v.language.startsWith('en'))).toBe(true);
    expect(filterVoices(list, { gender: 'male' }).every((v) => v.gender === 'male')).toBe(true);
    expect(filterVoices(list, { query: 'rachel' }).map((v) => v.voice_id)).toContain('rachel');
    expect(filterVoices(list, { type: 'clone' })).toHaveLength(0);
  });
});

describe('listVoices', () => {
  it('merges the user clones ahead of the presets', async () => {
    const state = await db();
    await state.db.insert(voices).values({
      id: ulid(),
      providerId: 'minimax',
      voiceId: 'riya_clone_ab12cd34',
      name: 'Riya',
      language: 'en-IN',
      gender: 'female',
      isClone: true,
      createdAt: new Date(),
    });
    const all = await listVoices(state);
    expect(all[0]).toMatchObject({ name: 'Riya', is_clone: true });
    expect(all.some((v) => v.provider === 'elevenlabs' && !v.is_clone)).toBe(true);
    const clonesOnly = await listVoices(state, { type: 'clone' });
    expect(clonesOnly).toHaveLength(1);
  });
});

describe('bindPresetVoice (F-CHR-08)', () => {
  it('persists a provider-preset voice and binds it, reusing the row when picked again', async () => {
    const state = await db();
    const head = await createCharacter(state, { handle: 'maya', kind: 'character', display_name: 'Maya' });
    const firstId = await bindPresetVoice(state, head.id, head.current_version, {
      provider: 'elevenlabs',
      voice_id: 'rachel',
      name: 'Rachel',
    });
    // The preset is stored as a non-clone voice and bound to the current version.
    const stored = await state.db.select().from(voices).where(eq(voices.id, firstId));
    expect(stored[0]?.isClone).toBe(false);
    const bound = await boundVoice(state, head.id, head.current_version);
    expect(bound?.provider).toBe('elevenlabs');
    expect(bound?.voice_id).toBe('rachel');
    // Picking the same preset again reuses the same stored row (provider+voice id
    // is unique), so no duplicate voice is created.
    const secondId = await bindPresetVoice(state, head.id, head.current_version, {
      provider: 'elevenlabs',
      voice_id: 'rachel',
    });
    expect(secondId).toBe(firstId);
    const allRachel = await state.db.select().from(voices).where(eq(voices.voiceId, 'rachel'));
    expect(allRachel).toHaveLength(1);
  });
});

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDatabaseState, createDatabase, characterVoices, spendLedger, voices } from '@kilnry/db';
import { eq } from 'drizzle-orm';
import { createCharacter } from './store.js';
import { boundVoice } from './voices.js';
import { seedRegistry } from '../registry/store.js';
import { designVoice, MAX_DESCRIPTION_CHARS, type DesignServices } from './voice-design.js';

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose();
});

async function db(): Promise<Awaited<ReturnType<typeof createDatabase>>> {
  const root = mkdtempSync(join(tmpdir(), 'kilnry-voice-design-'));
  const state = createDatabase(join(root, 'data'), { memory: true });
  disposers.push(async () => {
    await closeDatabaseState(state);
    rmSync(root, { recursive: true, force: true });
  });
  await state.ready;
  await seedRegistry(state);
  return state;
}

function minimaxFetch(): typeof fetch {
  return (async (url: string) => {
    if (String(url).endsWith('/voice_design')) {
      return new Response(
        JSON.stringify({ voice_id: 'ttv-voice-123', trial_audio: 'ab', base_resp: { status_code: 0 } }),
        { status: 200 },
      );
    }
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
}

function services(state: Awaited<ReturnType<typeof createDatabase>>): DesignServices {
  return {
    db: state,
    keyFor: () => Promise.resolve('a-key'),
    fetch: minimaxFetch(),
    now: () => new Date('2026-09-21T00:00:00Z'),
  };
}

describe('voice design (F-VOI-03)', () => {
  it('refuses an empty or over-long description', async () => {
    const state = await db();
    await expect(
      designVoice(services(state), {
        name: 'Narrator',
        provider: 'minimax',
        description: '   ',
        preview_text: 'Hello there.',
        confirmed_cost_usd: 3,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(
      designVoice(services(state), {
        name: 'Narrator',
        provider: 'minimax',
        description: 'x'.repeat(MAX_DESCRIPTION_CHARS + 1),
        preview_text: 'Hello there.',
        confirmed_cost_usd: 3,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('designs a MiniMax voice, records it as a design, and charges one $3 ledger row', async () => {
    const state = await db();
    const head = await createCharacter(state, { handle: 'maya', kind: 'character', display_name: 'Maya' });
    const result = await designVoice(services(state), {
      name: 'Warm Narrator',
      provider: 'minimax',
      description: 'A warm, low-pitched narrator in her forties, unhurried.',
      preview_text: 'This is a preview of the designed voice.',
      language: 'en',
      confirmed_cost_usd: 3,
      bind_to: 'maya',
    });
    expect(result.provider).toBe('minimax');
    expect(result.voice_id).toBe('ttv-voice-123');
    expect(result.bound_to).toBe('maya');
    // The row is a design: is_clone with clone_kind 'design' and no sample.
    const row = await state.db.select().from(voices).where(eq(voices.id, result.voice_ulid));
    expect(row[0]?.isClone).toBe(true);
    expect(row[0]?.cloneKind).toBe('design');
    expect(row[0]?.sampleAssetId).toBeNull();
    // It binds like a clone.
    const bound = await boundVoice(state, head.id, head.current_version);
    expect(bound?.voice_id).toBe('ttv-voice-123');
    const binding = await state.db
      .select()
      .from(characterVoices)
      .where(eq(characterVoices.characterId, head.id));
    expect(binding[0]?.voiceUlid).toBe(result.voice_ulid);
    // Exactly one spend-ledger row, at the $3 design price.
    const ledger = await state.db.select().from(spendLedger);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.providerId).toBe('minimax');
    expect(Number(ledger[0]?.actualUsd)).toBeCloseTo(3, 4);
  });

  it('refuses when the confirmed price is below the registry price, with no row written', async () => {
    const state = await db();
    await expect(
      designVoice(services(state), {
        name: 'Narrator',
        provider: 'minimax',
        description: 'A calm narrator.',
        preview_text: 'Hello.',
        confirmed_cost_usd: 1,
      }),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    expect(await state.db.select().from(spendLedger)).toHaveLength(0);
    expect(await state.db.select().from(voices).where(eq(voices.isClone, true))).toHaveLength(0);
  });
});

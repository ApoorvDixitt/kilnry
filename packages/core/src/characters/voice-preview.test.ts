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
import { seedRegistry } from '../registry/store.js';
import { previewVoice, deleteVoice, PREVIEW_SAMPLE } from './voice-preview.js';

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose();
});

async function db(): Promise<Awaited<ReturnType<typeof createDatabase>>> {
  const root = mkdtempSync(join(tmpdir(), 'kilnry-preview-'));
  const state = createDatabase(join(root, 'data'), { memory: true });
  disposers.push(async () => {
    await closeDatabaseState(state);
    rmSync(root, { recursive: true, force: true });
  });
  await state.ready;
  await seedRegistry(state);
  return state;
}

describe('voice preview and deletion (F-VOI-01)', () => {
  it('prices an ElevenLabs preview, synthesises it, and records one ledger row', async () => {
    const state = await db();
    let synthesisedText = '';
    const result = await previewVoice(
      {
        db: state,
        synth: async ({ text }) => {
          synthesisedText = text;
          return { bytes: new Uint8Array([1, 2, 3]), mime: 'audio/mpeg' };
        },
      },
      { provider: 'elevenlabs', voiceId: 'v1' },
    );
    // The fixed sample is synthesised and priced from the ElevenLabs
    // text-to-speech row ($0.10 per 1,000 characters), so a short sample costs a
    // fraction of a cent.
    expect(synthesisedText).toBe(PREVIEW_SAMPLE);
    expect(result.mime).toBe('audio/mpeg');
    expect(result.estimate_usd).toBeGreaterThan(0);
    expect(result.estimate_usd).toBeLessThan(0.05);
    // Exactly one spend-ledger row, kind voice_preview, no job id.
    const ledger = await state.db.select().from(spendLedger);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.kind).toBe('voice_preview');
    expect(ledger[0]?.providerId).toBe('elevenlabs');
  });

  it('refuses a preview for a provider without a wired synthesis path', async () => {
    const state = await db();
    await expect(
      previewVoice(
        { db: state, synth: async () => ({ bytes: new Uint8Array(), mime: 'audio/mpeg' }) },
        { provider: 'minimax', voiceId: 'v1' },
      ),
    ).rejects.toMatchObject({ code: 'NO_PROVIDER' });
    const ledger = await state.db.select().from(spendLedger);
    expect(ledger).toHaveLength(0);
  });

  it('deletes a stored voice and its bindings', async () => {
    const state = await db();
    await state.db
      .insert(voices)
      .values({ id: 'voice-1', providerId: 'minimax', voiceId: 'p1', name: 'One' });
    await state.db
      .insert(characterVoices)
      .values({ characterId: 'char-1', version: 1, voiceUlid: 'voice-1' });
    const removed = await deleteVoice(state, 'voice-1');
    expect(removed).toBe(true);
    expect(await state.db.select().from(voices).where(eq(voices.id, 'voice-1'))).toHaveLength(0);
    expect(
      await state.db.select().from(characterVoices).where(eq(characterVoices.voiceUlid, 'voice-1')),
    ).toHaveLength(0);
    // Deleting a voice that does not exist reports nothing removed.
    expect(await deleteVoice(state, 'missing')).toBe(false);
  });
});

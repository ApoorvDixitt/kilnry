// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDatabaseState, createDatabase, characterVoices, voices } from '@kilnry/db';
import { eq } from 'drizzle-orm';
import { createCharacter } from './store.js';
import { setConsent } from './consent.js';
import { boundVoice } from './voices.js';
import { cloneVoice, sampleLongEnough, type CloneServices } from './voice-clone.js';

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose();
});

async function db(): Promise<Awaited<ReturnType<typeof createDatabase>>> {
  const root = mkdtempSync(join(tmpdir(), 'kilnry-voice-'));
  const state = createDatabase(join(root, 'data'), { memory: true });
  disposers.push(async () => {
    await closeDatabaseState(state);
    rmSync(root, { recursive: true, force: true });
  });
  await state.ready;
  return state;
}

// A fetch stub for the MiniMax upload-then-clone flow.
function minimaxFetch(): typeof fetch {
  return (async (url: string) => {
    if (String(url).endsWith('/files/upload')) {
      return new Response(JSON.stringify({ file: { file_id: 'file-1' } }), { status: 200 });
    }
    if (String(url).endsWith('/voice_clone')) {
      return new Response(JSON.stringify({ base_resp: { status_code: 0 } }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
}

function services(state: Awaited<ReturnType<typeof createDatabase>>, fetchImpl: typeof fetch): CloneServices {
  return {
    db: state,
    keyFor: () => Promise.resolve('a-key'),
    fetch: fetchImpl,
    now: () => new Date('2026-09-21T00:00:00Z'),
  };
}

describe('voice cloning (F-VOI-02) and binding (F-CHR-08)', () => {
  it('needs at least ten seconds of sample', () => {
    expect(sampleLongEnough(9)).toBe(false);
    expect(sampleLongEnough(10)).toBe(true);
  });

  it('refuses to clone without consent ticked', async () => {
    const state = await db();
    await expect(
      cloneVoice(services(state, minimaxFetch()), {
        name: 'Riya',
        provider: 'minimax',
        sample_url: 'https://media.test/sample.mp3',
        sample_seconds: 30,
        consent_confirmed: false,
        confirmed_cost_usd: 1.5,
      }),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
  });

  it('refuses a sample shorter than ten seconds', async () => {
    const state = await db();
    await expect(
      cloneVoice(services(state, minimaxFetch()), {
        name: 'Riya',
        provider: 'minimax',
        sample_url: 'https://media.test/sample.mp3',
        sample_seconds: 6,
        consent_confirmed: true,
        confirmed_cost_usd: 1.5,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('clones a MiniMax voice, records it, and binds it to a Character', async () => {
    const state = await db();
    const head = await createCharacter(state, { handle: 'maya', kind: 'character', display_name: 'Maya' });
    const result = await cloneVoice(services(state, minimaxFetch()), {
      name: 'Riya',
      provider: 'minimax',
      sample_url: 'https://media.test/sample.mp3',
      sample_seconds: 45,
      consent_confirmed: true,
      confirmed_cost_usd: 1.5,
      bind_to: 'maya',
    });
    expect(result.provider).toBe('minimax');
    expect(result.voice_id).toMatch(/^kilnry_/);
    expect(result.bound_to).toBe('maya');
    // The clone row carries is_clone, the consent moment and the exact voice id.
    const row = await state.db.select().from(voices).where(eq(voices.id, result.voice_ulid));
    expect(row[0]?.isClone).toBe(true);
    expect(row[0]?.consentConfirmedAt).not.toBeNull();
    expect(row[0]?.voiceId).toBe(result.voice_id);
    // The binding points the current version at the new voice.
    const bound = await boundVoice(state, head.id, head.current_version);
    expect(bound?.voice_id).toBe(result.voice_id);
    const binding = await state.db
      .select()
      .from(characterVoices)
      .where(eq(characterVoices.characterId, head.id));
    expect(binding[0]?.voiceUlid).toBe(result.voice_ulid);
  });

  it('refuses to bind to a real person until consent is recorded', async () => {
    const state = await db();
    const head = await createCharacter(state, {
      handle: 'real',
      kind: 'character',
      display_name: 'Real',
      is_real_person: true,
    });
    await expect(
      cloneVoice(services(state, minimaxFetch()), {
        name: 'Riya',
        provider: 'minimax',
        sample_url: 'https://media.test/sample.mp3',
        sample_seconds: 45,
        consent_confirmed: true,
        confirmed_cost_usd: 1.5,
        bind_to: 'real',
      }),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    await setConsent(state, head.id, { is_real_person: true, status: 'self' });
    const result = await cloneVoice(services(state, minimaxFetch()), {
      name: 'Riya',
      provider: 'minimax',
      sample_url: 'https://media.test/sample.mp3',
      sample_seconds: 45,
      consent_confirmed: true,
      confirmed_cost_usd: 1.5,
      bind_to: 'real',
    });
    expect(result.bound_to).toBe('real');
  });
});

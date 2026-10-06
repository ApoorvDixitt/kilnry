// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  budgets,
  closeDatabaseState,
  createDatabase,
  characterVoices,
  priceSnapshots,
  spendLedger,
  voices,
} from '@kilnry/db';
import { eq } from 'drizzle-orm';
import { createCharacter } from './store.js';
import { setConsent } from './consent.js';
import { boundVoice } from './voices.js';
import { seedRegistry } from '../registry/store.js';
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
  await seedRegistry(state);
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
    // The clone is charged exactly once through the spend ledger, at the MiniMax
    // clone price ($1.50), with no job id.
    const ledger = await state.db.select().from(spendLedger);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.kind).toBe('voice_clone');
    expect(ledger[0]?.providerId).toBe('minimax');
    expect(Number(ledger[0]?.actualUsd)).toBeCloseTo(1.5, 4);
  });

  it('refuses to clone when the confirmed price is below the registry price', async () => {
    const state = await db();
    await createCharacter(state, { handle: 'maya', kind: 'character', display_name: 'Maya' });
    await expect(
      cloneVoice(services(state, minimaxFetch()), {
        name: 'Riya',
        provider: 'minimax',
        sample_url: 'https://media.test/sample.mp3',
        sample_seconds: 45,
        consent_confirmed: true,
        confirmed_cost_usd: 0.5,
      }),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    const ledger = await state.db.select().from(spendLedger);
    expect(ledger).toHaveLength(0);
    const cloneRows = await state.db.select().from(voices).where(eq(voices.isClone, true));
    expect(cloneRows).toHaveLength(0);
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

  // A fal clone goes through fal's queue (submit → status COMPLETED → response);
  // the output carries custom_voice_id, never the submit. The mock mirrors that.
  function falQueueFetch(): typeof fetch {
    return (async (url: string) => {
      const u = String(url);
      if (u.endsWith('/fal-ai/minimax/voice-clone') && !u.includes('/requests/')) {
        return new Response(
          JSON.stringify({
            request_id: 'req-c',
            status_url: 'https://queue.fal.run/fal-ai/minimax/voice-clone/requests/req-c/status',
            response_url: 'https://queue.fal.run/fal-ai/minimax/voice-clone/requests/req-c',
          }),
          { status: 200 },
        );
      }
      if (u.includes('/status'))
        return new Response(JSON.stringify({ status: 'COMPLETED' }), { status: 200 });
      return new Response(
        JSON.stringify({ custom_voice_id: 'fal-clone-7', audio: { url: 'https://x/p.mp3' } }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
  }

  it('clones a fal voice through the queue and reads custom_voice_id from the response', async () => {
    const state = await db();
    const result = await cloneVoice(services(state, falQueueFetch()), {
      name: 'Clone via fal',
      provider: 'fal',
      sample_url: 'https://media.test/sample.mp3',
      sample_seconds: 20,
      consent_confirmed: true,
      confirmed_cost_usd: 1.5,
    });
    expect(result.provider).toBe('fal');
    expect(result.voice_id).toBe('fal-clone-7');
    const ledger = await state.db.select().from(spendLedger);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.currencyNote).toBe('voice clone');
    expect(ledger[0]?.actualUsd).toBe('1.500000');
    expect(ledger[0]?.modelId).toBe('fal-ai/minimax/voice-clone');
  });

  // Kling's own voice creation on fal (fal-ai/kling-video/create-voice): a queue
  // endpoint whose output is { voice_id } (schema KlingVideoCreateVoiceOutput).
  // The mock mirrors the documented protocol: the submit returns only the queue
  // handles, the response carries the id.
  function klingQueueFetch(seen: Array<{ url: string; body: unknown }>): typeof fetch {
    return (async (url: string, init?: { body?: string }) => {
      const u = String(url);
      if (u.endsWith('/fal-ai/kling-video/create-voice') && !u.includes('/requests/')) {
        seen.push({ url: u, body: init?.body ? JSON.parse(init.body) : undefined });
        return new Response(
          JSON.stringify({
            request_id: 'req-k',
            status_url: 'https://queue.fal.run/fal-ai/kling-video/create-voice/requests/req-k/status',
            response_url: 'https://queue.fal.run/fal-ai/kling-video/create-voice/requests/req-k',
          }),
          { status: 200 },
        );
      }
      if (u.includes('/status'))
        return new Response(JSON.stringify({ status: 'COMPLETED' }), { status: 200 });
      return new Response(JSON.stringify({ voice_id: '829877809978941442' }), { status: 200 });
    }) as unknown as typeof fetch;
  }

  it('creates a Kling voice through fal, records it as a kling voice and charges $0.007', async () => {
    const state = await db();
    const seen: Array<{ url: string; body: unknown }> = [];
    const keys: string[] = [];
    const svc: CloneServices = {
      ...services(state, klingQueueFetch(seen)),
      keyFor: (provider) => {
        keys.push(provider);
        return Promise.resolve('fal-key');
      },
    };
    const result = await cloneVoice(svc, {
      name: 'Maya for Kling',
      provider: 'kling',
      sample_url: 'https://media.test/maya.wav',
      sample_seconds: 12,
      consent_confirmed: true,
      confirmed_cost_usd: 0.007,
    });
    // fal's key pays; the request is the documented { voice_url }.
    expect(keys).toEqual(['fal']);
    expect(seen).toEqual([
      {
        url: 'https://queue.fal.run/fal-ai/kling-video/create-voice',
        body: { voice_url: 'https://media.test/maya.wav' },
      },
    ]);
    expect(result.provider).toBe('kling');
    expect(result.voice_id).toBe('829877809978941442');
    // The stored voice belongs to Kling, so the resolver sends it only to Kling's
    // voice_ids[] (TRD-14 §2).
    const stored = await state.db.select().from(voices);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ providerId: 'kling', voiceId: '829877809978941442', isClone: true });
    const ledger = await state.db.select().from(spendLedger);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      providerId: 'fal',
      modelId: 'fal-ai/kling-video/create-voice',
      actualUsd: '0.007000',
      currencyNote: 'voice clone',
    });
  });

  it('refuses a Kling sample outside 5–30 s and a MiniMax one under 10 s', async () => {
    const state = await db();
    const base = {
      name: 'x',
      sample_url: 'https://media.test/maya.wav',
      consent_confirmed: true,
    };
    await expect(
      cloneVoice(services(state, klingQueueFetch([])), {
        ...base,
        provider: 'kling',
        sample_seconds: 4,
        confirmed_cost_usd: 0.007,
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'The sample is too short. Kling (via fal) needs at least 5 seconds of clean speech.',
    });
    await expect(
      cloneVoice(services(state, klingQueueFetch([])), {
        ...base,
        provider: 'kling',
        sample_seconds: 31,
        confirmed_cost_usd: 0.007,
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'The sample is too long. Kling (via fal) takes at most 30 seconds.',
    });
    expect(sampleLongEnough(6, 'kling')).toBe(true);
    expect(sampleLongEnough(6, 'minimax')).toBe(false);
    expect(sampleLongEnough(6, 'fal')).toBe(false);
  });
});

// F-PRV-04 / PRD-14 "reserve": a clone holds its spend before the provider call,
// inside the same locked transaction as the cap check, so two concurrent clones
// against a cap with room for one admit exactly one.
describe('voice clone budget hold (F-PRV-04)', () => {
  // A MiniMax fetch whose clone call waits until released, so two clones are
  // in flight at once and the second's cap check sees the first's hold.
  function gatedMinimaxFetch(): { fetch: typeof fetch; release: () => void; cloneCalls: number } {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const state = { cloneCalls: 0 };
    const impl = (async (url: string) => {
      if (String(url).endsWith('/files/upload')) {
        return new Response(JSON.stringify({ file: { file_id: 'file-1' } }), { status: 200 });
      }
      if (String(url).endsWith('/voice_clone')) {
        state.cloneCalls += 1;
        await gate;
        return new Response(JSON.stringify({ base_resp: { status_code: 0 } }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    return {
      fetch: impl,
      release: () => release(),
      get cloneCalls() {
        return state.cloneCalls;
      },
    };
  }

  it('two concurrent clones against a cap with room for one: one succeeds, one is BUDGET_EXCEEDED', async () => {
    const state = await db();
    // Room for one $1.50 clone, not two.
    // The migration seeds the $10/day and $100/month defaults (F-08); this
    // test sets its own cap on an otherwise cap-free database.
    await state.db.delete(budgets);
    await state.db.insert(budgets).values({ scope: 'daily', capUsd: '2.000000', behavior: 'block' });
    const gated = gatedMinimaxFetch();
    const input = {
      provider: 'minimax' as const,
      sample_url: 'https://media.test/sample.mp3',
      sample_seconds: 30,
      consent_confirmed: true,
      confirmed_cost_usd: 1.5,
    };
    const settle = (promise: Promise<unknown>) =>
      promise.then(
        (value) => ({ status: 'fulfilled' as const, value }),
        (reason: unknown) => ({ status: 'rejected' as const, reason }),
      );
    const first = settle(cloneVoice(services(state, gated.fetch), { ...input, name: 'First' }));
    const second = settle(cloneVoice(services(state, gated.fetch), { ...input, name: 'Second' }));
    // The provider answers only after one clone holds the money and reaches it;
    // by then the other has been checked against the cap with that hold in place.
    await expect
      .poll(async () => (await state.db.select().from(spendLedger)).length, { timeout: 10_000 })
      .toBe(1);
    await expect.poll(() => gated.cloneCalls, { timeout: 10_000 }).toBe(1);
    const early = await Promise.race([first, second]);
    expect(early.status).toBe('rejected');
    gated.release();
    const outcomes = await Promise.all([first, second]);
    const ok = outcomes.filter((o) => o.status === 'fulfilled');
    const refused = outcomes.filter((o) => o.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect((refused[0] as { reason: unknown }).reason).toMatchObject({ code: 'BUDGET_EXCEEDED' });
    // The refused clone never reached the provider; the admitted one did once.
    expect(gated.cloneCalls).toBe(1);
    // Exactly one ledger row, settled from 'pending' to 'voice clone' at $1.50.
    const ledger = await state.db.select().from(spendLedger);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ currencyNote: 'voice clone', actualUsd: '1.500000' });
  });

  it('releases the hold when the provider refuses before charging', async () => {
    const state = await db();
    const refusing = (async (url: string) => {
      if (String(url).endsWith('/files/upload')) {
        return new Response(JSON.stringify({ file: { file_id: 'file-1' } }), { status: 200 });
      }
      // MiniMax's documented moderation refusal, status_code 1026.
      return new Response(JSON.stringify({ base_resp: { status_code: 1026 } }), { status: 200 });
    }) as unknown as typeof fetch;
    await expect(
      cloneVoice(services(state, refusing), {
        name: 'Refused',
        provider: 'minimax',
        sample_url: 'https://media.test/sample.mp3',
        sample_seconds: 30,
        consent_confirmed: true,
        confirmed_cost_usd: 1.5,
      }),
    ).rejects.toMatchObject({ code: 'MODERATION_REJECTED' });
    expect(await state.db.select().from(spendLedger)).toHaveLength(0);
    expect(await state.db.select().from(voices)).toHaveLength(0);
  });
});

describe('cloning refuses a Character that reads as a minor (F-07, PRD-07 §7)', () => {
  it('refuses a fictional Character described as a child: no provider call, no hold', async () => {
    const state = await db();
    await createCharacter(state, {
      handle: 'little_one',
      kind: 'character',
      display_name: 'Little One',
      appearance: { descriptor: 'a child in a yellow raincoat', anchors: [], negative_traits: [] },
    });
    let providerCalls = 0;
    const counting = (async (url: string, init?: RequestInit) => {
      providerCalls += 1;
      return minimaxFetch()(url, init);
    }) as unknown as typeof fetch;
    await expect(
      cloneVoice(services(state, counting), {
        name: 'Little',
        provider: 'minimax',
        sample_url: 'https://media.test/sample.mp3',
        sample_seconds: 30,
        consent_confirmed: true,
        confirmed_cost_usd: 1.5,
        bind_to: 'little_one',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', message: 'Kilnry does not train or clone minors.' });
    expect(providerCalls).toBe(0);
    expect(await state.db.select().from(spendLedger)).toHaveLength(0);
  });
});

// F-21: a price snapshot older than 30 days must not price a paid call that
// does not go through a job without the explicit override (PRD-14 §8).
describe('voice clone refuses a stale price (F-21, F-PRV-07)', () => {
  it('refuses a 31-day-old price with CONFIRMATION_REQUIRED and calls no provider', async () => {
    const state = await db();
    await state.db.update(priceSnapshots).set({ fetchedAt: new Date(Date.now() - 31 * 86_400_000) });
    let calls = 0;
    const counting = (async (url: string, init?: RequestInit) => {
      calls += 1;
      return minimaxFetch()(url, init);
    }) as unknown as typeof fetch;
    await expect(
      cloneVoice(services(state, counting), {
        name: 'Riya',
        provider: 'minimax',
        sample_url: 'https://media.test/sample.mp3',
        sample_seconds: 30,
        consent_confirmed: true,
        confirmed_cost_usd: 1.5,
      }),
    ).rejects.toMatchObject({
      code: 'CONFIRMATION_REQUIRED',
      options: { details: { reason: 'stale_price' } },
    });
    expect(calls).toBe(0);
    // The explicit override lets the same clone proceed.
    await expect(
      cloneVoice(services(state, minimaxFetch()), {
        name: 'Riya',
        provider: 'minimax',
        sample_url: 'https://media.test/sample.mp3',
        sample_seconds: 30,
        consent_confirmed: true,
        confirmed_cost_usd: 1.5,
        allow_stale_price: true,
      }),
    ).resolves.toMatchObject({ provider: 'minimax' });
  });
});

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  budgets,
  closeDatabaseState,
  createDatabase,
  priceSnapshots,
  spendLedger,
  trainedIdentities,
} from '@kilnry/db';
import { eq } from 'drizzle-orm';
import type { ProviderAdapter, SubmitHandle } from '../providers/adapter.js';
import { seedRegistry } from '../registry/store.js';
import { addReferences, createCharacter } from './store.js';
import { setConsent } from './consent.js';
import { startTraining, triggerWordFor, isValidTriggerWord, type TrainingServices } from './training.js';
import { seedPinnedClock } from '../registry/seed/test-clock.js';

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose();
});

async function db(): Promise<Awaited<ReturnType<typeof createDatabase>>> {
  const root = mkdtempSync(join(tmpdir(), 'kilnry-train-'));
  const state = createDatabase(join(root, 'data'), { memory: true });
  disposers.push(async () => {
    await closeDatabaseState(state);
    rmSync(root, { recursive: true, force: true });
  });
  await state.ready;
  await seedRegistry(state);
  return state;
}

const LORA_BYTES = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const LORA_SHA = createHash('sha256').update(LORA_BYTES).digest('hex');

// A fal-like trainer that submits, reports completed at once, and returns a LoRA
// URL. The download URL is served by the same fetch stub.
function fakeFalAdapter(): ProviderAdapter {
  return {
    id: 'fal',
    display_name: 'fal',
    base_url: 'https://queue.fal.run',
    key_detection: null,
    concurrency: { default: 2, max_known: null },
    retention_days: 7,
    training_on_inputs: false,
    supports_authoritative_estimate: false,
    idempotency: 'none',
    testKey: () => Promise.resolve({ ok: true, latency_ms: 1 }),
    listModels: () => Promise.resolve([]),
    submit: () =>
      Promise.resolve({
        provider: 'fal',
        model_id: 'fal-ai/flux-lora-fast-training',
        provider_request_id: 'train-1',
        status_url: 'https://queue.fal.run/status',
        submitted_at: new Date().toISOString(),
        payload_redacted: {},
      } satisfies SubmitHandle),
    poll: () =>
      Promise.resolve({
        state: 'completed',
        result: {
          outputs: [
            { kind: 'json', url: 'https://cdn.fal.media/lora.safetensors', mime: 'application/octet-stream' },
          ],
        },
      }),
    cancel: () => Promise.resolve({ ok: true }),
    download: () => Promise.resolve([]),
    normalizeError: (error) => error as never,
  };
}

function trainingServices(
  state: Awaited<ReturnType<typeof createDatabase>>,
  fetchImpl: typeof fetch,
): TrainingServices {
  const root = mkdtempSync(join(tmpdir(), 'kilnry-ids-'));
  disposers.push(() => Promise.resolve(rmSync(root, { recursive: true, force: true })));
  return {
    db: state,
    adapters: { fal: fakeFalAdapter() },
    keyFor: () => Promise.resolve('fal-key'),
    assetUrl: (id) => `https://media.test/${id}`,
    identitiesRoot: root,
    fetch: fetchImpl,
    now: seedPinnedClock(),
  };
}

async function characterWithRefs(state: Awaited<ReturnType<typeof createDatabase>>): Promise<string> {
  const head = await createCharacter(state, { handle: 'maya', kind: 'character', display_name: 'Maya' });
  await addReferences(state, head.id, [
    { asset_id: 'a1', role: 'anchor', view: 'front' },
    { asset_id: 'a2', role: 'turnaround', view: 'three_quarter_left' },
    { asset_id: 'a3', role: 'turnaround', view: 'profile_left' },
    { asset_id: 'a4', role: 'outfit', label: 'wet' },
  ]);
  return head.id;
}

describe('identity training (F-CHR-07)', () => {
  it('derives a trigger word from the handle and rejects short ones', () => {
    expect(triggerWordFor('maya')).toBe('mayak');
    expect(triggerWordFor('a-b_c')).toBe('abck');
    expect(isValidTriggerWord('mayak')).toBe(true);
    expect(isValidTriggerWord('a1')).toBe(false);
  });

  it('trains a fal LoRA, copies the artefact to disk and verifies its checksum', async () => {
    const state = await db();
    const characterId = await characterWithRefs(state);
    const fetchImpl = (async (url: string) => {
      if (String(url).endsWith('lora.safetensors')) {
        return new Response(LORA_BYTES, { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const result = await startTraining(trainingServices(state, fetchImpl), {
      handle: 'maya',
      trainer: 'fal',
      confirmed_cost_usd: 2,
    });
    expect(result.status).toBe('ready');
    expect(result.kind).toBe('lora');
    expect(result.sha256).toBe(LORA_SHA);
    expect(result.local_path).toBeDefined();
    expect(existsSync(result.local_path!)).toBe(true);
    // The manifest sits beside the safetensors with the checksum and trigger word.
    const manifestPath = join(result.local_path!.replace(/lora\.safetensors$/, ''), 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    expect(manifest.sha256).toBe(LORA_SHA);
    expect(manifest.trigger_word).toBe('mayak');
    // A ready row lands in trained_identities with the local path.
    const rows = await state.db
      .select()
      .from(trainedIdentities)
      .where(eq(trainedIdentities.characterId, characterId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('ready');
    expect(rows[0]?.localPath).toBe(result.local_path);
    expect(rows[0]?.sha256).toBe(LORA_SHA);
    // The run is charged exactly once, through the spend ledger, at the price the
    // registry holds for the fal LoRA trainer (1,000 steps × $0.002 = $2.00).
    const ledger = await state.db.select().from(spendLedger);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.kind).toBe('train');
    expect(ledger[0]?.providerId).toBe('fal');
    expect(Number(ledger[0]?.actualUsd)).toBeCloseTo(2, 4);
  });

  it('refuses to train when the confirmed price is below the registry price', async () => {
    const state = await db();
    await characterWithRefs(state);
    const fetchImpl = (async (url: string) => {
      if (String(url).endsWith('lora.safetensors')) return new Response(LORA_BYTES, { status: 200 });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    // The fal LoRA run prices at $2.00; confirming $1.00 must be refused before
    // any provider request, and nothing is charged.
    await expect(
      startTraining(trainingServices(state, fetchImpl), {
        handle: 'maya',
        trainer: 'fal',
        confirmed_cost_usd: 1,
      }),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    const ledger = await state.db.select().from(spendLedger);
    expect(ledger).toHaveLength(0);
    const rows = await state.db.select().from(trainedIdentities);
    expect(rows).toHaveLength(0);
  });

  it('creates a Soul ID that keeps only its remote id and no local artefact', async () => {
    const state = await db();
    await characterWithRefs(state);
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/custom-references') && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'cr_9d2e', status: 'queued' }), { status: 200 });
      }
      if (String(url).includes('/custom-references/cr_9d2e')) {
        return new Response(JSON.stringify({ id: 'cr_9d2e', status: 'completed' }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const services = trainingServices(state, fetchImpl);
    services.adapters = {
      higgsfield: { ...fakeFalAdapter(), id: 'higgsfield', base_url: 'https://api.higgsfield.ai' },
    };
    const result = await startTraining(services, {
      handle: 'maya',
      trainer: 'higgsfield',
      confirmed_cost_usd: 2.5,
    });
    expect(result.status).toBe('ready');
    expect(result.kind).toBe('soul_id');
    expect(result.remote_id).toBe('cr_9d2e');
    expect(result.local_path).toBeUndefined();
    const rows = await state.db.select().from(trainedIdentities);
    expect(rows[0]?.remoteId).toBe('cr_9d2e');
    expect(rows[0]?.localPath).toBeNull();
  });

  it('refuses to train a real person until consent is recorded (hard invariant)', async () => {
    const state = await db();
    const head = await createCharacter(state, {
      handle: 'real',
      kind: 'character',
      display_name: 'Real Person',
      is_real_person: true,
    });
    await addReferences(state, head.id, [
      { asset_id: 'a1', role: 'anchor', view: 'front' },
      { asset_id: 'a2', role: 'turnaround' },
      { asset_id: 'a3', role: 'turnaround' },
      { asset_id: 'a4', role: 'outfit' },
    ]);
    const fetchImpl = (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    await expect(
      startTraining(trainingServices(state, fetchImpl), {
        handle: 'real',
        trainer: 'fal',
        confirmed_cost_usd: 2,
      }),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    // With consent recorded the same call proceeds.
    await setConsent(state, head.id, { is_real_person: true, status: 'self' });
    const fetchOk = (async (url: string) => {
      if (String(url).endsWith('lora.safetensors')) return new Response(LORA_BYTES, { status: 200 });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const result = await startTraining(trainingServices(state, fetchOk), {
      handle: 'real',
      trainer: 'fal',
      confirmed_cost_usd: 2,
    });
    expect(result.status).toBe('ready');
  });
});

describe('training refuses a Character that reads as a minor (F-07, PRD-07 §7)', () => {
  it('refuses with the exact copy even with consent recorded, and never submits', async () => {
    const state = await db();
    const head = await createCharacter(state, {
      handle: 'teen',
      kind: 'character',
      display_name: 'Teen',
      is_real_person: true,
      appearance: { descriptor: 'a 15 year old boy', anchors: [], negative_traits: [] },
    });
    await addReferences(state, head.id, [
      { asset_id: 'a1', role: 'anchor', view: 'front' },
      { asset_id: 'a2', role: 'turnaround' },
      { asset_id: 'a3', role: 'turnaround' },
      { asset_id: 'a4', role: 'outfit' },
    ]);
    await setConsent(state, head.id, { is_real_person: true, status: 'self' });
    const services = trainingServices(state, (async () => new Response('{}')) as unknown as typeof fetch);
    let submits = 0;
    const adapter = services.adapters.fal!;
    services.adapters = {
      fal: {
        ...adapter,
        submit: (...args: Parameters<typeof adapter.submit>) => {
          submits += 1;
          return adapter.submit(...args);
        },
      },
    };
    await expect(
      startTraining(services, { handle: 'teen', trainer: 'fal', confirmed_cost_usd: 2 }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', message: 'Kilnry does not train or clone minors.' });
    expect(submits).toBe(0);
  });
});

// F-01: training held no money before the provider call (reserveBudget checks
// the caps but writes nothing), so two concurrent runs against a cap with room
// for one both reached the trainer. The estimate is now a pending ledger row
// written inside the locked cap check (holdSpend, D-60).
describe('training holds its estimate before the trainer is called (F-01, F-PRV-04)', () => {
  it('two concurrent runs against a cap with room for one: one trains, one is BUDGET_EXCEEDED', async () => {
    const state = await db();
    await characterWithRefs(state);
    // Room for one $2.00 fal run, not two.
    // The migration seeds the $10/day and $100/month defaults (F-08); this
    // test sets its own cap on an otherwise cap-free database.
    await state.db.delete(budgets);
    await state.db.insert(budgets).values({ scope: 'daily', capUsd: '3.000000', behavior: 'block' });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let submits = 0;
    const fetchImpl = (async (url: string) =>
      String(url).endsWith('lora.safetensors')
        ? new Response(LORA_BYTES, { status: 200 })
        : new Response('{}', { status: 200 })) as unknown as typeof fetch;
    const services = trainingServices(state, fetchImpl);
    const base = fakeFalAdapter();
    services.adapters = {
      fal: {
        ...base,
        submit: async (...args: Parameters<typeof base.submit>) => {
          submits += 1;
          await gate;
          return base.submit(...args);
        },
      },
    };
    const settle = (promise: Promise<unknown>) =>
      promise.then(
        (value) => ({ status: 'fulfilled' as const, value }),
        (reason: unknown) => ({ status: 'rejected' as const, reason }),
      );
    const first = settle(startTraining(services, { handle: 'maya', trainer: 'fal', confirmed_cost_usd: 2 }));
    const second = settle(startTraining(services, { handle: 'maya', trainer: 'fal', confirmed_cost_usd: 2 }));
    // Let both reach the cap check before the first trainer call returns.
    await new Promise((resolve) => setTimeout(resolve, 300));
    release();
    const outcomes = await Promise.all([first, second]);
    const refused = outcomes.filter(
      (o) => o.status === 'rejected' && (o.reason as { code?: string }).code === 'BUDGET_EXCEEDED',
    );
    expect(refused).toHaveLength(1);
    expect(submits).toBe(1);
    const ledger = await state.db.select().from(spendLedger);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.kind).toBe('train');
    expect(Number(ledger[0]?.actualUsd)).toBeCloseTo(2, 6);
    expect(ledger[0]?.currencyNote).toBe('training');
  });

  it('releases the hold when the trainer refuses the submission', async () => {
    const state = await db();
    await characterWithRefs(state);
    const services = trainingServices(state, (async () => new Response('{}')) as unknown as typeof fetch);
    const base = fakeFalAdapter();
    services.adapters = {
      fal: { ...base, submit: () => Promise.reject(new Error('fal refused the training input')) },
    };
    const result = await startTraining(services, { handle: 'maya', trainer: 'fal', confirmed_cost_usd: 2 });
    expect(result.status).toBe('failed');
    expect(await state.db.select().from(spendLedger)).toHaveLength(0);
  });
});

// F-21: a price snapshot older than 30 days must not price a paid call that
// does not go through a job without the explicit override (PRD-14 §8).
describe('training refuses a stale price (F-21, F-PRV-07)', () => {
  it('refuses a 31-day-old price with CONFIRMATION_REQUIRED and holds nothing', async () => {
    const state = await db();
    await characterWithRefs(state);
    await state.db
      .update(priceSnapshots)
      .set({ fetchedAt: new Date(seedPinnedClock()().getTime() - 31 * 86_400_000) });
    const services = trainingServices(state, (async () => new Response('{}')) as unknown as typeof fetch);
    await expect(
      startTraining(services, { handle: 'maya', trainer: 'fal', confirmed_cost_usd: 2 }),
    ).rejects.toMatchObject({
      code: 'CONFIRMATION_REQUIRED',
      options: { details: { reason: 'stale_price' } },
    });
    expect(await state.db.select().from(spendLedger)).toHaveLength(0);
  });
});

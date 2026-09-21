// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assets,
  budgets,
  characterVersions,
  closeDatabaseState,
  createDatabase,
  jobs,
  priceSnapshots,
  spendLedger,
} from '@kilnry/db';
import { readEmbeddedMetadata } from '@kilnry/media';
import { KilnryError } from '../errors.js';
import { addReferences, createCharacter } from '../characters/store.js';
import { ProviderKeyStore } from '../security/key-store.js';
import { CanonicalRequestSchema, type CanonicalRequest } from '../types.js';
import type { PollStatus, ProviderAdapter, ProviderResult, SubmitHandle } from '../providers/adapter.js';
import { prepareLibraryRoot } from '../library/root.js';
import { readSidecar } from '../library/sidecar.js';
import { canonicalQueueName, JobEngine, type JobEngineOptions } from './engine.js';

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const disposers: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose();
});

interface FakeState {
  submitCalls: number;
  pollCalls: number;
  keepRunning: boolean;
  activeSubmits: number;
  maxActiveSubmits: number;
  submitFailures: KilnryError[];
  poll: PollStatus[];
  submitDelayMs: number;
  downloadFailure?: Error;
  result: ProviderResult;
}

function fakeAdapter(overrides: Partial<FakeState> = {}): { adapter: ProviderAdapter; state: FakeState } {
  const state: FakeState = {
    submitCalls: 0,
    pollCalls: 0,
    keepRunning: false,
    activeSubmits: 0,
    maxActiveSubmits: 0,
    submitFailures: [],
    poll: [],
    submitDelayMs: 0,
    result: {
      outputs: [{ kind: 'image', bytes: tinyPng, mime: 'image/png' }],
      billing: { actual_usd: 0.0042, source: 'fixture' },
    },
    ...overrides,
  };
  const adapter: ProviderAdapter = {
    id: 'fal',
    display_name: 'fal fixture',
    base_url: 'https://fixture.invalid',
    key_detection: null,
    concurrency: { default: 2, max_known: 2 },
    retention_days: 7,
    training_on_inputs: false,
    supports_authoritative_estimate: false,
    idempotency: 'none',
    testKey: () => Promise.resolve({ ok: true, latency_ms: 1 }),
    listModels: () => Promise.resolve([]),
    async submit(request): Promise<SubmitHandle> {
      state.submitCalls += 1;
      state.activeSubmits += 1;
      state.maxActiveSubmits = Math.max(state.maxActiveSubmits, state.activeSubmits);
      try {
        if (state.submitDelayMs) await new Promise((resolve) => setTimeout(resolve, state.submitDelayMs));
        const failure = state.submitFailures.shift();
        if (failure) throw failure;
        return {
          provider: 'fal',
          model_id: String(request.params.extra?.model ?? 'fixture/model'),
          provider_request_id: `fixture-${state.submitCalls}`,
          status_url: `https://fixture.invalid/status/${state.submitCalls}`,
          response_url: `https://fixture.invalid/result/${state.submitCalls}`,
          submitted_at: new Date().toISOString(),
          ...(state.poll.length === 0 && !state.keepRunning ? { inline_result: state.result } : {}),
          payload_redacted: { prompt_length: request.prompt.length },
        };
      } finally {
        state.activeSubmits -= 1;
      }
    },
    poll(): Promise<PollStatus> {
      state.pollCalls += 1;
      return Promise.resolve(
        state.poll.shift() ??
          (state.keepRunning
            ? { state: 'running', progress: 0.1 }
            : { state: 'completed', result: state.result }),
      );
    },
    cancel(): Promise<{ ok: boolean }> {
      return Promise.resolve({ ok: true });
    },
    async download(result) {
      if (state.downloadFailure) throw state.downloadFailure;
      return result.outputs.map((output, index) => {
        const bytes = output.bytes ?? Buffer.from(output.base64 ?? '', 'base64');
        return {
          index,
          bytes,
          mime: output.mime ?? 'application/octet-stream',
          sha256: createHash('sha256').update(bytes).digest('hex'),
        };
      });
    },
    normalizeError(error) {
      return error instanceof KilnryError
        ? error
        : new KilnryError('PROVIDER_ERROR', 'Fixture adapter failed.', { cause: error });
    },
  };
  return { adapter, state };
}

async function harness(
  adapter: ProviderAdapter,
  withKey = true,
  engineOptions: Partial<Pick<JobEngineOptions, 'pollScheduleMs' | 'pollTimeoutMs'>> = {},
): Promise<{
  engine: JobEngine;
  state: ReturnType<typeof createDatabase>;
  keyStore: ProviderKeyStore;
  root: string;
  library: string;
  libraryId: string;
  stages: string[];
}> {
  const root = mkdtempSync(join(tmpdir(), 'kilnry-engine-'));
  const dataDir = join(root, 'data');
  const library = join(root, 'library');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const state = createDatabase(dataDir, { memory: true });
  await state.ready;
  const prepared = prepareLibraryRoot(library, dataDir);
  const keyStore = new ProviderKeyStore({
    dataDir,
    database: state,
    environment: { KILNRY_MASTER_KEY: randomBytes(32).toString('hex') },
  });
  await keyStore.initialize();
  if (withKey) await keyStore.save('fal', ['fixture', 'credential'].join('-'));
  const stages: string[] = [];
  const engine = new JobEngine({
    state,
    keyStore,
    adapters: { fal: adapter },
    dataDir,
    libraryRoot: library,
    libraryId: prepared.marker.library_id,
    pollScheduleMs: engineOptions.pollScheduleMs ?? [0],
    submitRetryScheduleMs: [0],
    pollTimeoutMs: engineOptions.pollTimeoutMs ?? 2000,
    log: (_level, event) => {
      if (event.startsWith('job_finalize_')) stages.push(event.replace('job_finalize_', ''));
    },
  });
  disposers.push(async () => {
    await engine.stop();
    await closeDatabaseState(state);
    rmSync(root, { recursive: true, force: true });
  });
  await engine.start();
  return { engine, state, keyStore, root, library, libraryId: prepared.marker.library_id, stages };
}

function imageRequest(): CanonicalRequest {
  return CanonicalRequestSchema.parse({
    kind: 'image',
    capability: 'text2image',
    prompt: 'a small kiln arch on warm paper',
    params: { width: 1000, height: 1000, quality: 'draft' },
    medias: [],
    injections: [],
    count: 1,
    target_folder: 'inbox',
    source: 'ui',
  });
}

async function createConfirmed(engine: JobEngine, clientRequestId?: string) {
  const priced = await engine.estimate(imageRequest());
  return engine.createJob({
    request: imageRequest(),
    confirmed_cost_usd: priced.estimate.estimate_usd,
    confirmed_by: 'user',
    ...(clientRequestId ? { client_request_id: clientRequestId } : {}),
  });
}

describe('pg-boss job engine', () => {
  it('freezes a referenced character version the moment a job is accepted (F-CHR-10)', async () => {
    const fake = fakeAdapter();
    const { engine, state } = await harness(fake.adapter);
    const head = await createCharacter(state, {
      handle: 'maya',
      kind: 'character',
      display_name: 'Maya',
    });
    await addReferences(state, head.id, [{ asset_id: 'anchor-asset', role: 'anchor', view: 'front' }]);
    const before = await state.db
      .select({ frozen: characterVersions.frozen })
      .from(characterVersions)
      .where(eq(characterVersions.characterId, head.id));
    expect(before[0]?.frozen).toBe(false);

    const request = CanonicalRequestSchema.parse({
      kind: 'image',
      capability: 'text2image',
      prompt: 'a portrait of @maya on warm paper',
      params: { width: 1000, height: 1000, quality: 'draft' },
      medias: [],
      injections: [{ handle: 'maya', version: 1, strategy: 'text', inputs: [] }],
      count: 1,
      target_folder: 'inbox',
      source: 'ui',
    });
    const priced = await engine.estimate(request);
    await engine.createJob({
      request,
      confirmed_cost_usd: priced.estimate.estimate_usd,
      confirmed_by: 'user',
    });

    const after = await state.db
      .select({ frozen: characterVersions.frozen })
      .from(characterVersions)
      .where(eq(characterVersions.characterId, head.id));
    expect(after[0]?.frozen).toBe(true);
  });

  it('runs estimate → confirm → reserve → submit → finalize → reconcile → ledger on shared PGlite', async () => {
    const fake = fakeAdapter();
    const { engine, state, stages, library } = await harness(fake.adapter);
    expect(await engine.boss.schemaVersion()).toBeTypeOf('number');
    expect(canonicalQueueName('fal')).toBe('gen:fal');
    expect(await engine.boss.getQueue('gen/fal')).not.toBeNull();
    expect(await engine.boss.getSchedule('maintenance', 'price-refresh')).not.toBeNull();
    const created = await createConfirmed(engine, 'engine-happy');
    const terminal = await engine.waitForJob(created.job_id, 5000);
    expect(terminal).toMatchObject({ status: 'completed', actualUsd: '0.004200' });
    expect(fake.state.submitCalls).toBe(1);
    expect(stages).toEqual(['file', 'sidecar', 'embedded', 'database', 'thumbnail']);
    const assetRows = await state.db.select().from(assets);
    expect(assetRows).toHaveLength(1);
    const absolute = join(library, assetRows[0]!.path);
    expect(existsSync(absolute)).toBe(true);
    const sidecar = await readSidecar(absolute);
    expect(sidecar.ok && sidecar.value.generation?.actual_usd).toBe(0.0042);
    expect((await readEmbeddedMetadata(absolute, 'image/png')).payload).toBeDefined();
    expect(existsSync(join(state.dataDir, 'cache', 'thumbs', `${assetRows[0]!.id}.webp`))).toBe(true);
    expect(await state.db.select().from(spendLedger)).toHaveLength(1);
    await engine.stop();
    await expect(state.client.query('select 1')).resolves.toBeDefined();
  });

  it('does not enqueue without confirmation and replays a client request idempotently', async () => {
    const fake = fakeAdapter();
    const { engine, state } = await harness(fake.adapter);
    await expect(engine.createJob({ request: imageRequest(), confirmed_by: 'user' })).rejects.toMatchObject({
      code: 'CONFIRMATION_REQUIRED',
    });
    expect(await state.db.select().from(jobs)).toHaveLength(0);
    const first = await createConfirmed(engine, 'same-click');
    const second = await createConfirmed(engine, 'same-click');
    expect(second).toMatchObject({ job_id: first.job_id, idempotent_replay: true });
    await engine.waitForJob(first.job_id, 5000);
    expect(fake.state.submitCalls).toBe(1);
  });

  it('serializes concurrent reservations so the combined estimate cannot cross a cap', async () => {
    const fake = fakeAdapter({ submitDelayMs: 75 });
    const { engine, state } = await harness(fake.adapter);
    await state.db.insert(budgets).values({
      scope: 'daily',
      capUsd: '0.007500',
      behavior: 'block',
    });
    const outcomes = await Promise.allSettled([
      createConfirmed(engine, 'budget-race-a'),
      createConfirmed(engine, 'budget-race-b'),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
    expect(rejected).toMatchObject({ status: 'rejected', reason: { code: 'BUDGET_EXCEEDED' } });
    expect(await state.db.select().from(jobs)).toHaveLength(1);
  });

  it('shows stale estimates but refuses submission unless the caller explicitly allows one', async () => {
    const fake = fakeAdapter();
    const { engine, state } = await harness(fake.adapter);
    await state.db.update(priceSnapshots).set({ fetchedAt: new Date('2020-01-01T00:00:00.000Z') });
    const priced = await engine.estimate(imageRequest());
    expect(priced.estimate.adjustments).toContain('stale_price');
    await expect(
      engine.createJob({
        request: imageRequest(),
        confirmed_cost_usd: priced.estimate.estimate_usd,
        confirmed_by: 'user',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', options: { details: { stale_price: true } } });
    const created = await engine.createJob({
      request: imageRequest(),
      confirmed_cost_usd: priced.estimate.estimate_usd,
      confirmed_by: 'user',
      allow_stale_price: true,
    });
    expect(await engine.waitForJob(created.job_id, 5000)).toMatchObject({ status: 'completed' });
  });

  it('writes a zero ledger entry for moderation', async () => {
    const fake = fakeAdapter({
      submitFailures: [
        new KilnryError('MODERATION_REJECTED', "Blocked by the provider's content filter. Not charged.", {
          provider: 'fal',
          retryable: false,
          details: { billed: 'no' },
        }),
      ],
    });
    const { engine, state } = await harness(fake.adapter);
    const created = await createConfirmed(engine);
    expect(await engine.waitForJob(created.job_id, 5000)).toMatchObject({
      status: 'moderated',
      actualUsd: '0.000000',
    });
    expect(await state.db.select().from(spendLedger)).toMatchObject([{ actualUsd: '0.000000' }]);
  });

  it('never resubmits an ambiguous timeout but safely retries definitive 5xx responses', async () => {
    const ambiguous = fakeAdapter({
      submitFailures: [
        new KilnryError('TIMEOUT', 'Outcome unknown.', {
          provider: 'fal',
          retryable: true,
          details: { ambiguous_submit: true, billed: 'maybe' },
        }),
      ],
    });
    const firstHarness = await harness(ambiguous.adapter);
    const first = await createConfirmed(firstHarness.engine);
    expect(await firstHarness.engine.waitForJob(first.job_id, 5000)).toMatchObject({ status: 'failed' });
    expect(ambiguous.state.submitCalls).toBe(1);
    await firstHarness.engine.retryJob(first.job_id, first.estimate.estimate_usd);
    expect(await firstHarness.engine.waitForJob(first.job_id, 5000)).toMatchObject({
      status: 'completed',
    });
    expect(ambiguous.state.submitCalls).toBe(2);
    expect(
      await firstHarness.state.db.select().from(spendLedger).where(eq(spendLedger.jobId, first.job_id)),
    ).toMatchObject([{ actualUsd: '0.004200' }]);

    const safe = fakeAdapter({
      submitFailures: [
        new KilnryError('PROVIDER_ERROR', 'Definitive server error.', {
          provider: 'fal',
          retryable: true,
          details: { billed: 'no' },
        }),
        new KilnryError('PROVIDER_ERROR', 'Definitive server error.', {
          provider: 'fal',
          retryable: true,
          details: { billed: 'no' },
        }),
      ],
    });
    const secondHarness = await harness(safe.adapter);
    const second = await createConfirmed(secondHarness.engine);
    expect(await secondHarness.engine.waitForJob(second.job_id, 5000)).toMatchObject({ status: 'completed' });
    expect(safe.state.submitCalls).toBe(3);
  });

  it('resumes a running accepted request by polling without another submit', async () => {
    const fake = fakeAdapter({
      poll: [
        {
          state: 'completed',
          result: {
            outputs: [{ kind: 'image', bytes: tinyPng, mime: 'image/png' }],
            billing: { actual_usd: 0.005, source: 'fixture' },
          },
        },
      ],
    });
    const { engine, state } = await harness(fake.adapter);
    await engine.stop();
    const request = CanonicalRequestSchema.parse({
      ...imageRequest(),
      params: { ...imageRequest().params, extra: { model: 'fal-ai/flux-2/klein/4b' } },
    });
    const id = '01J00000000000000000000009';
    await state.db.insert(jobs).values({
      id,
      kind: 'image',
      status: 'running',
      source: 'ui',
      providerId: 'fal',
      modelId: 'fal-ai/flux-2/klein/4b',
      request,
      estimateUsd: '0.005000',
      confirmedCostUsd: '0.005000',
      confirmedBy: 'user',
      providerRequestId: 'accepted-fixture',
      providerStatusUrl: 'https://fixture.invalid/status/accepted-fixture',
      resolved: {
        handle: {
          provider: 'fal',
          model_id: 'fal-ai/flux-2/klein/4b',
          provider_request_id: 'accepted-fixture',
          status_url: 'https://fixture.invalid/status/accepted-fixture',
          response_url: 'https://fixture.invalid/result/accepted-fixture',
          submitted_at: new Date().toISOString(),
          payload_redacted: {},
        },
      },
      unitPrice: {
        unit: 'megapixel',
        amount_usd: 0.005,
        fetched_at: new Date().toISOString(),
        source_url: 'https://fal.ai/models/fal-ai/flux-2/klein/4b',
      },
      targetFolder: 'inbox',
      startedAt: new Date(),
    });
    await engine.start();
    expect(await engine.waitForJob(id, 5000)).toMatchObject({ status: 'completed' });
    expect(fake.state.submitCalls).toBe(0);
    expect(fake.state.pollCalls).toBe(1);
  });

  it('keeps an accepted job resumable across a graceful engine restart', async () => {
    const fake = fakeAdapter({ keepRunning: true });
    const { engine, state } = await harness(fake.adapter, true, {
      pollScheduleMs: [100],
      pollTimeoutMs: 10_000,
    });
    const created = await createConfirmed(engine, 'graceful-resume');
    await expect
      .poll(
        async () =>
          (await state.db.select().from(jobs).where(eq(jobs.id, created.job_id)))[0]?.providerRequestId,
      )
      .toBeTruthy();
    await engine.stop();
    expect((await state.db.select().from(jobs).where(eq(jobs.id, created.job_id)))[0]?.status).toBe(
      'running',
    );
    fake.state.keepRunning = false;
    fake.state.poll = [{ state: 'completed', result: fake.state.result }];
    await engine.start();
    expect(await engine.waitForJob(created.job_id, 5000)).toMatchObject({ status: 'completed' });
    expect(fake.state.submitCalls).toBe(1);
  });

  it('marks a crash during submit ambiguous instead of resubmitting', async () => {
    const fake = fakeAdapter();
    const { engine, state } = await harness(fake.adapter);
    await engine.stop();
    const id = '01J00000000000000000000008';
    await state.db.insert(jobs).values({
      id,
      kind: 'image',
      status: 'running',
      source: 'ui',
      providerId: 'fal',
      modelId: 'fal-ai/flux-2/klein/4b',
      request: CanonicalRequestSchema.parse({
        ...imageRequest(),
        params: { ...imageRequest().params, extra: { model: 'fal-ai/flux-2/klein/4b' } },
      }),
      estimateUsd: '0.005000',
      confirmedCostUsd: '0.005000',
      confirmedBy: 'user',
      stepLabel: 'submitting',
      startedAt: new Date(),
    });
    await engine.start();
    expect(await engine.waitForJob(id, 5000)).toMatchObject({ status: 'failed', errorCode: 'TIMEOUT' });
    expect(fake.state.submitCalls).toBe(0);
  });

  it('keeps provider submission concurrency within the adapter cap', async () => {
    const fake = fakeAdapter({ submitDelayMs: 60 });
    const { engine } = await harness(fake.adapter);
    const jobsCreated = await Promise.all(
      Array.from({ length: 5 }, (_, index) => createConfirmed(engine, `concurrency-${index}`)),
    );
    await Promise.all(jobsCreated.map((created) => engine.waitForJob(created.job_id, 5000)));
    expect(fake.state.maxActiveSubmits).toBeLessThanOrEqual(2);
  });

  it('finalizes every output independently and writes one ledger row for the job', async () => {
    const fake = fakeAdapter({
      result: {
        outputs: [
          { kind: 'image', bytes: tinyPng, mime: 'image/png' },
          { kind: 'image', bytes: tinyPng, mime: 'image/png' },
        ],
        billing: { actual_usd: 0.0084, source: 'fixture' },
      },
    });
    const { engine, state, library } = await harness(fake.adapter);
    const created = await createConfirmed(engine, 'multi-output');
    const terminal = await engine.waitForJob(created.job_id, 5000);
    expect(terminal.outputAssetIds).toHaveLength(2);
    expect(new Set(terminal.outputAssetIds).size).toBe(2);
    expect(await state.db.select().from(assets)).toHaveLength(2);
    const media = readdirSync(join(library, 'inbox')).filter((name) => !name.endsWith('.kilnry.json'));
    expect(media).toHaveLength(2);
    const outputIndexes = await Promise.all(
      media.map(async (name) => {
        const sidecar = await readSidecar(join(library, 'inbox', name));
        return sidecar.ok ? sidecar.value.generation?.output_index : undefined;
      }),
    );
    expect(outputIndexes.sort()).toEqual([0, 1]);
    expect(await state.db.select().from(spendLedger)).toHaveLength(1);
  });

  it('keeps the known provider charge when a paid result cannot be downloaded', async () => {
    const fake = fakeAdapter({ downloadFailure: new Error('fixture CDN unavailable') });
    const { engine, state } = await harness(fake.adapter);
    const created = await createConfirmed(engine, 'paid-download-failure');
    expect(await engine.waitForJob(created.job_id, 5000)).toMatchObject({
      status: 'failed',
      actualUsd: '0.004200',
    });
    expect(await state.db.select().from(spendLedger)).toMatchObject([
      { actualUsd: '0.004200', currencyNote: 'failure:charged' },
    ]);
  });

  it('performs zero outbound work when no provider key is configured', async () => {
    const fake = fakeAdapter();
    const { engine, state } = await harness(fake.adapter, false);
    await expect(engine.estimate(imageRequest())).rejects.toMatchObject({ code: 'NO_PROVIDER' });
    expect(fake.state.submitCalls).toBe(0);
    expect(await state.db.select().from(jobs)).toHaveLength(0);
  });

  it('cancels a running provider job and records a terminal ledger row', async () => {
    const fake = fakeAdapter({
      poll: Array.from({ length: 100 }, () => ({ state: 'running', progress: 0.1 }) as PollStatus),
    });
    const { engine, state } = await harness(fake.adapter);
    const created = await createConfirmed(engine);
    await expect
      .poll(async () => (await state.db.select().from(jobs).where(eq(jobs.id, created.job_id)))[0]?.status)
      .toBe('running');
    expect(await engine.cancelJob(created.job_id)).toMatchObject({
      status: 'cancelled',
      provider_acknowledged: true,
    });
    expect(await engine.waitForJob(created.job_id, 5000)).toMatchObject({ status: 'cancelled' });
    expect(
      await state.db.select().from(spendLedger).where(eq(spendLedger.jobId, created.job_id)),
    ).toHaveLength(1);
  });
});

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assetCharacters,
  assets,
  auditEvents,
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
import { addReferences, createCharacter, setAppearance } from '../characters/store.js';
import { bindPresetVoice } from '../characters/voices.js';
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
  engineOptions: Partial<Pick<JobEngineOptions, 'pollScheduleMs' | 'pollTimeoutMs' | 'runDriver'>> & {
    extraAdapters?: ProviderAdapter[];
  } = {},
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
  for (const extra of engineOptions.extraAdapters ?? []) {
    await keyStore.save(extra.id, ['fixture', 'credential'].join('-'));
  }
  const stages: string[] = [];
  const engine = new JobEngine({
    state,
    keyStore,
    adapters: {
      fal: adapter,
      ...Object.fromEntries((engineOptions.extraAdapters ?? []).map((extra) => [extra.id, extra])),
    },
    dataDir,
    libraryRoot: library,
    libraryId: prepared.marker.library_id,
    pollScheduleMs: engineOptions.pollScheduleMs ?? [0],
    submitRetryScheduleMs: [0],
    pollTimeoutMs: engineOptions.pollTimeoutMs ?? 2000,
    ...(engineOptions.runDriver ? { runDriver: engineOptions.runDriver } : {}),
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

  it('the runs queue collapses two enqueues of one run to a single job (short policy)', async () => {
    const fake = fakeAdapter();
    // A driver that blocks forever so the first fetched drive stays active; the
    // test only cares that the second enqueue of the same run does not add a row.
    const { engine, state } = await harness(fake.adapter, true, {
      runDriver: () => new Promise<void>(() => {}),
    });
    expect(await engine.boss.getQueue('runs')).not.toBeNull();

    await engine.enqueueRun('run-xyz');
    await engine.enqueueRun('run-xyz');

    const rows = await state.client.query<{ count: string }>(
      "select count(*)::text as count from pgboss.job where name = 'runs' and data->>'run_id' = $1",
      ['run-xyz'],
    );
    expect(rows.rows[0]?.count).toBe('1');
  });

  it('enqueueImport keeps a second import of one path, deferred to the next slot (F-LIB-04)', async () => {
    const fake = fakeAdapter();
    const { engine, state } = await harness(fake.adapter, true, {
      runDriver: () => new Promise<void>(() => {}),
    });
    const path = '/library/inbox/edited.png';
    // Two imports of the same path within the debounce window. singletonNextSlot
    // means the first runs now and the second is deferred, not dropped — so a
    // change 1 s after the first import is still indexed (pg-boss manager.js
    // returns null on the conflict without it).
    await engine.enqueueImport(path);
    await engine.enqueueImport(path);
    const rows = await state.client.query<{ count: string }>(
      "select count(*)::text as count from pgboss.job where name = 'maintenance' and data->>'path' = $1",
      [path],
    );
    expect(rows.rows[0]?.count).toBe('2');
    const slots = await state.client.query<{ start_after: string }>(
      "select start_after from pgboss.job where name = 'maintenance' and data->>'path' = $1 order by start_after",
      [path],
    );
    // The second job's slot is strictly later than the first's.
    expect(new Date(slots.rows[1]!.start_after).getTime()).toBeGreaterThan(
      new Date(slots.rows[0]!.start_after).getTime(),
    );
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

  it('writes a spend-ledger row and an audit event tied to the run and step (F-JOB-02)', async () => {
    const fake = fakeAdapter();
    const { engine, state } = await harness(fake.adapter);
    const priced = await engine.estimate(imageRequest());
    const created = await engine.createJob({
      request: imageRequest(),
      confirmed_cost_usd: priced.estimate.estimate_usd,
      confirmed_by: 'user',
      client_request_id: 'run_42:board[0]:0',
      run_id: 'run_42',
      step_id: 'board',
    });
    const terminal = await engine.waitForJob(created.job_id, 5000);
    expect(terminal.status).toBe('completed');

    // One ledger row for the job.
    const ledger = await state.db.select().from(spendLedger).where(eq(spendLedger.jobId, created.job_id));
    expect(ledger).toHaveLength(1);

    // One audit event tied to the same job, carrying the run and step id so a
    // run's spend can be audited end to end.
    const audit = await state.db.select().from(auditEvents).where(eq(auditEvents.target, created.job_id));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe('job.settled');
    expect(audit[0]?.actor).toBe('user');
    expect(audit[0]?.meta).toMatchObject({
      run_id: 'run_42',
      step_id: 'board',
      source: 'ui',
      actual_usd: 0.0042,
    });
    await engine.stop();
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
    // The migration seeds the $10/day and $100/month defaults (F-08); this
    // test sets its own cap on an otherwise cap-free database.
    await state.db.delete(budgets);
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

  it('checks a timed-out job without resubmitting and completes it on re-poll (S-11)', async () => {
    // A job that keeps polling running hits the short poll timeout and fails; its
    // stored handle stays. checkJob re-polls that same request — now the fixture
    // reports completed — so the job finishes without a second submit.
    const fake = fakeAdapter({ keepRunning: true });
    const { engine, state } = await harness(fake.adapter, true, {
      pollScheduleMs: [50],
      pollTimeoutMs: 300,
    });
    const created = await createConfirmed(engine, 'timeout-check');
    expect(await engine.waitForJob(created.job_id, 5000)).toMatchObject({
      status: 'failed',
      errorCode: 'TIMEOUT',
    });
    const submitsAfterTimeout = fake.state.submitCalls;
    expect(submitsAfterTimeout).toBe(1);
    const failedRow = (await state.db.select().from(jobs).where(eq(jobs.id, created.job_id)))[0];
    expect(failedRow?.providerRequestId).toBeTruthy();

    // The provider has since finished; a status check re-polls and completes it.
    fake.state.keepRunning = false;
    fake.state.poll = [{ state: 'completed', result: fake.state.result }];
    await engine.checkJob(created.job_id);
    const done = (await state.db.select().from(jobs).where(eq(jobs.id, created.job_id)))[0];
    expect(done?.status).toBe('completed');
    // No second submit: the same provider request id was reused.
    expect(fake.state.submitCalls).toBe(submitsAfterTimeout);
    expect(done?.providerRequestId).toBe(failedRow?.providerRequestId);
  });

  it('leaves a still-rendering job running and hands it to the worker on check (S-11)', async () => {
    // When the one bounded poll finds the request still in flight, the check must
    // not resubmit or hang: it leaves the job running with a watching step label
    // and hands it back to the worker through the resume queue.
    const fake = fakeAdapter({ keepRunning: true });
    const { engine, state } = await harness(fake.adapter, true, {
      pollScheduleMs: [50],
      pollTimeoutMs: 300,
    });
    const created = await createConfirmed(engine, 'still-rendering');
    expect(await engine.waitForJob(created.job_id, 5000)).toMatchObject({
      status: 'failed',
      errorCode: 'TIMEOUT',
    });
    const submitsAfterTimeout = fake.state.submitCalls;
    const failedRow = (await state.db.select().from(jobs).where(eq(jobs.id, created.job_id)))[0];
    // The next poll still reports running; stop the engine first so the resume
    // enqueue is not immediately consumed, letting us observe the running state.
    await engine.stop();
    fake.state.poll = [{ state: 'running', progress: 0.5 }];
    await engine.checkJob(created.job_id);
    const watching = (await state.db.select().from(jobs).where(eq(jobs.id, created.job_id)))[0];
    expect(watching?.status).toBe('running');
    expect(watching?.stepLabel).toContain('Kilnry is watching');
    // Still no second submit; the stored request id is unchanged.
    expect(fake.state.submitCalls).toBe(submitsAfterTimeout);
    expect(watching?.providerRequestId).toBe(failedRow?.providerRequestId);
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

// The engine runs the one character resolver for every host (F-CHR-09, TRD-14 §1):
// a request carrying `@maya` is rewritten and its references become provider
// inputs here, not in any composer.
describe('F-CHR-09 the engine resolves @mentions', () => {
  const MAYA = {
    descriptor:
      'A woman in her early thirties, medium-brown skin, dark chin-length bob with a blunt fringe, small scar on the left side of the chin, gold hoop earrings, navy linen kurta.',
    anchors: ['blunt fringe bob', 'chin scar', 'gold hoops', 'navy kurta'],
    negative_traits: ['glasses', 'beard'],
    gendered_noun: 'woman' as const,
  };

  async function seedMaya(state: Awaited<ReturnType<typeof harness>>['state'], library: string) {
    const anchorId = '01JAK7ANCH0000000000000000';
    mkdirSync(join(library, 'inbox'), { recursive: true });
    writeFileSync(join(library, 'inbox', 'maya-anchor.png'), tinyPng);
    await state.db.insert(assets).values({
      id: anchorId,
      path: join('inbox', 'maya-anchor.png'),
      folderPath: 'inbox',
      kind: 'image',
      mime: 'image/png',
      bytes: tinyPng.byteLength,
      sha256: 'a'.repeat(64),
      source: 'imported',
      createdAt: new Date('2026-09-22T00:00:00.000Z'),
    });
    const head = await createCharacter(state, { handle: 'maya', kind: 'character', display_name: 'Maya' });
    await setAppearance(state, head.id, MAYA);
    await addReferences(state, head.id, [{ asset_id: anchorId, role: 'anchor', view: 'front' }]);
    return { head, anchorId };
  }

  it('turns @maya into one Kling element, prices it, and records lineage on the output', async () => {
    const submitted: CanonicalRequest[] = [];
    const fake = fakeAdapter({
      result: {
        outputs: [{ kind: 'image', bytes: tinyPng, mime: 'image/png' }],
        billing: { actual_usd: 0.5, source: 'fixture' },
      },
    });
    const inner = fake.adapter.submit.bind(fake.adapter);
    fake.adapter.submit = (request, context) => {
      submitted.push(request);
      return inner(request, context);
    };
    const { engine, state, library } = await harness(fake.adapter);
    const { head, anchorId } = await seedMaya(state, library);

    const request = CanonicalRequestSchema.parse({
      kind: 'video',
      capability: 'text2video',
      prompt: 'Slow dolly-in on @maya at a chai stall',
      params: { duration_s: 5, resolution: '1080p' },
      medias: [],
      injections: [],
      count: 1,
      target_folder: 'inbox',
      source: 'ui',
    });
    const constraints = { pinned_model: 'fal-ai/kling-video/v3/pro/text-to-video' };
    const plain = await engine.estimate(
      { ...request, prompt: 'Slow dolly-in on a woman at a chai stall' },
      constraints,
    );
    const priced = await engine.estimate(request, constraints);

    // The stored request is the resolved one: rewritten prompt, one element
    // injection, the anchor as a reference media, and the element fragment in
    // params.extra with a placeholder the worker binds at submit.
    expect(priced.request.prompt).toBe('Slow dolly-in on @Element1 at a chai stall');
    expect(priced.request.original_prompt).toBe('Slow dolly-in on @maya at a chai stall');
    expect(priced.request.negative_prompt).toBe('glasses, beard');
    expect(priced.request.injections).toEqual([
      { handle: 'maya', version: 1, strategy: 'elements', inputs: [anchorId] },
    ]);
    expect(priced.request.medias).toEqual([{ role: 'reference', asset_id: anchorId }]);
    expect(priced.request.params.extra?.elements).toEqual([
      { frontal_image_url: `kilnry-asset://${anchorId}`, reference_image_urls: [] },
    ]);
    // PRD-07 §6: elements roughly double Kling's per-second price.
    expect(priced.estimate.estimate_usd).toBeCloseTo(plain.estimate.estimate_usd * 2, 6);
    expect(priced.estimate.adjustments).toContain('elements roughly double Kling per-second price on I2V');

    const created = await engine.createJob({
      request,
      constraints,
      confirmed_cost_usd: priced.estimate.estimate_usd,
      confirmed_by: 'user',
    });
    const row = (await state.db.select().from(jobs).where(eq(jobs.id, created.job_id)))[0]!;
    expect((row.request as CanonicalRequest).prompt).toBe('Slow dolly-in on @Element1 at a chai stall');
    expect(row.characters).toEqual([
      { handle: 'maya', version: 1, strategy: 'elements', inputs: [anchorId] },
    ]);

    const terminal = await engine.waitForJob(created.job_id, 5000);
    expect(terminal).toMatchObject({ status: 'completed' });
    // The provider saw the uploaded anchor inside elements[], not a placeholder,
    // and not a second time as image_urls.
    expect(submitted).toHaveLength(1);
    const sent = submitted[0]!;
    const elements = sent.params.extra?.elements as Array<{ frontal_image_url: string }>;
    expect(elements[0]!.frontal_image_url).toMatch(/^data:image\/png;base64,/);
    expect(sent.medias).toEqual([]);
    expect(sent.prompt).toBe('Slow dolly-in on @Element1 at a chai stall');

    // Lineage: an asset_characters row per output, and both prompts in the sidecar.
    const outputs = (await state.db.select().from(assets)).filter((asset) => asset.id !== anchorId);
    expect(outputs).toHaveLength(1);
    const links = await state.db
      .select()
      .from(assetCharacters)
      .where(eq(assetCharacters.assetId, outputs[0]!.id));
    expect(links).toEqual([
      expect.objectContaining({ characterId: head.id, version: 1, strategy: 'elements' }),
    ]);
    const sidecar = await readSidecar(join(library, outputs[0]!.path));
    expect(sidecar.ok && sidecar.value.generation?.prompt).toBe('Slow dolly-in on @maya at a chai stall');
    expect(sidecar.ok && sidecar.value.generation?.resolved_prompt).toBe(
      'Slow dolly-in on @Element1 at a chai stall',
    );
  });

  it('appends the descriptor on a model with no reference slot (TRD-14 §7 example 6 form)', async () => {
    const fake = fakeAdapter();
    const { engine, state, library } = await harness(fake.adapter);
    await seedMaya(state, library);
    const request = CanonicalRequestSchema.parse({
      kind: 'image',
      capability: 'text2image',
      prompt: '@maya, fashion editorial, seamless grey, harsh flash',
      params: { width: 1000, height: 1000 },
      medias: [],
      injections: [],
      count: 1,
      target_folder: 'inbox',
      source: 'ui',
    });
    // FLUX LoRA has no reference slot and no trained LoRA for Maya, so the
    // descriptor and the Keep/Avoid clauses are the identity (byte-exact with
    // the resolver fixture's text form).
    const priced = await engine.estimate(request, { pinned_model: 'fal-ai/flux-lora' });
    expect(priced.request.prompt).toBe(
      'A woman in her early thirties, medium-brown skin, dark chin-length bob with a blunt fringe, small scar on the left side of the chin, gold hoop earrings, navy linen kurta. Keep: blunt fringe bob, chin scar, gold hoops, navy kurta. Fashion editorial, seamless grey, harsh flash. Avoid: glasses, beard.',
    );
    expect(priced.request.injections).toEqual([{ handle: 'maya', version: 1, strategy: 'text', inputs: [] }]);
    expect(priced.request.medias).toEqual([]);
    expect(priced.request.params.extra).not.toHaveProperty('elements');
  });

  it('leaves a prompt with no mention untouched and does not consult the resolver', async () => {
    const fake = fakeAdapter();
    const { engine } = await harness(fake.adapter);
    const priced = await engine.estimate(imageRequest());
    expect(priced.request.prompt).toBe('a small kiln arch on warm paper');
    expect(priced.request.original_prompt).toBeUndefined();
    expect(priced.request.injections).toEqual([]);
  });
});

// A bound voice is used only by the provider that made it (PRD-08 B4, TRD-14 §2):
// Auto switches the TTS model to the voice's provider and says so; a pinned model
// blocks. Never a different-sounding voice without a word.
describe('F-VOI-04 the engine honours the voice provider', () => {
  async function mayaWithVoice(state: Awaited<ReturnType<typeof harness>>['state'], provider: string) {
    const head = await createCharacter(state, { handle: 'maya', kind: 'character', display_name: 'Maya' });
    await bindPresetVoice(state, head.id, 1, { provider, voice_id: `${provider}-voice-1`, name: 'Riya' });
    return head;
  }
  const tts = CanonicalRequestSchema.parse({
    kind: 'audio',
    capability: 'tts',
    prompt: '@maya: "Welcome back to the channel."',
    params: {},
    medias: [],
    injections: [],
    count: 1,
    target_folder: 'inbox',
    source: 'ui',
  });

  it('blocks a pinned TTS model that cannot use the bound voice (INVALID_INPUT)', async () => {
    const fake = fakeAdapter();
    const { engine, state } = await harness(fake.adapter);
    await mayaWithVoice(state, 'minimax');
    await expect(
      engine.estimate(tts, { pinned_model: 'fal-ai/kokoro/american-english' }),
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message:
        "@maya cannot be used with Kokoro American English: its voice is minimax's. Pick a minimax model or Auto.",
    });
  });

  it('in Auto re-routes to the voice provider and records the adjustment', async () => {
    const fake = fakeAdapter();
    const eleven = {
      ...fakeAdapter().adapter,
      id: 'elevenlabs' as const,
      display_name: 'ElevenLabs fixture',
    };
    const { engine, state } = await harness(fake.adapter, true, { extraAdapters: [eleven] });
    // With fal and ElevenLabs connected, Auto's cheapest TTS route is on
    // ElevenLabs; Maya's voice was made on fal, so the router must come back to a
    // fal speech model and say so.
    await mayaWithVoice(state, 'fal');
    const control = await engine.estimate({ ...tts, prompt: 'Welcome back to the channel.' });
    expect(control.estimate.route.provider).toBe('elevenlabs');
    const priced = await engine.estimate(tts);
    expect(priced.estimate.route.provider).toBe('fal');
    expect(priced.estimate.adjustments).toContain('Routed to Kokoro American English for @maya');
    expect(priced.request.injections).toEqual([
      { handle: 'maya', version: 1, strategy: 'voice_id', inputs: [] },
    ]);
    expect(priced.request.params.extra?.voice_id).toBe('fal-voice-1');
  });

  // F-22, TRD-04 invariant 5: the worker re-checks confirmed_cost_usd before
  // submitting an MCP or Chat job. A queued row that reached the queue without
  // it (any path that skipped createJob's check) must fail, never spend.
  it('refuses to submit a chat job whose row carries no confirmed cost (F-22)', async () => {
    const fake = fakeAdapter();
    const { engine, state } = await harness(fake.adapter);
    const done = await createConfirmed(engine);
    await engine.waitForJob(done.job_id, 5000);
    const template = (await state.db.select().from(jobs).where(eq(jobs.id, done.job_id)))[0]!;
    await engine.stop();
    const bypassId = `${done.job_id.slice(0, 20)}BYPAS`;
    await state.db.insert(jobs).values({
      ...template,
      id: bypassId,
      status: 'queued',
      source: 'chat',
      clientRequestId: null,
      confirmedCostUsd: '0.000000',
      confirmedBy: 'auto',
      providerRequestId: null,
      providerStatusUrl: null,
      resolved: null,
      outputAssetIds: null,
      actualUsd: null,
      startedAt: null,
      finishedAt: null,
      errorCode: null,
      errorMessage: null,
      attempts: 0,
    });
    const submitsBefore = fake.state.submitCalls;
    await engine.start();
    const refused = await engine.waitForJob(bypassId, 5000);
    expect(refused.status).toBe('failed');
    expect(refused.errorCode).toBe('CONFIRMATION_REQUIRED');
    expect(fake.state.submitCalls).toBe(submitsBefore);
  });
});

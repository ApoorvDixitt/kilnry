// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Run driving is event-driven (TRD-12 §6 lines 11, 16, 21; TRD-08 §13). approve
// and start record the state change, enqueue one `runs` job and return the run
// immediately; a worker drives it to its next pause or the end. These tests
// stand in a fake boss for the engine's `runs` queue so the contract is checked
// without pg-boss: approve returns before the drive finishes; the drive emits
// run.awaiting at a checkpoint and run.updated at the end with the TRD-08 fields;
// a drive that throws leaves the run failed with the reason on the live step;
// two approves on one checkpoint drive once. Each would fail if approveRun drove
// the run inside the request, swallowed the drive error, or re-drove on a repeat.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { closeDatabaseState, createDatabase, runs, runSteps, type DatabaseState } from '@kilnry/db';
import { eventHub, type KilnryEvent, type SequencedEvent } from '@kilnry/core';
import { approveRun, driveRunToRest, getRun } from './workflows';

// A two-step workflow: a hard checkpoint, then a run-time `set` that completes
// in the executor with no engine. The set reads nothing external, so the whole
// drive runs in-process — the behaviour under test is the orchestration around
// the drive, not a spending step.
const WORKFLOW = `
id: kilnry-drive-demo
name: Drive demo
version: 1.0.0
category: video
steps:
  - id: gate
    kind: approval
    mode: hard
    title: "Approve to render"
  - id: done
    kind: set
    values: { ok: "yes" }
    depends_on: [gate]
outputs:
  final: "{{ steps.done.outputs.ok }}"
`;

// A soft, skippable gate before a set, then a hard gate. A run with
// skip_approvals drives straight through the soft gate (TRD-12 §4 line 116) and
// stops at the hard one; without it, it stops at the soft gate first.
const SOFT_THEN_HARD = `
id: kilnry-drive-soft
name: Drive soft
version: 1.0.0
category: video
steps:
  - id: soft_gate
    kind: approval
    mode: soft
    skippable: true
    title: "Soft approve"
  - id: mid
    kind: set
    values: { ok: "yes" }
    depends_on: [soft_gate]
  - id: hard_gate
    kind: approval
    mode: hard
    title: "Hard approve"
    depends_on: [mid]
`;

const PLAN = {
  plan_id: 'plan-drive',
  workflow_id: 'kilnry-drive-demo',
  workflow_version: '1.0.0',
  inputs: {},
  vars: {},
  steps: [
    { step_id: 'gate', kind: 'approval', name: 'Approve to render', estimate_usd: 0 },
    { step_id: 'done', kind: 'set', name: 'done', estimate_usd: 0 },
  ],
  total_estimate_usd: 0,
  created_at: new Date().toISOString(),
};

let database: DatabaseState;
let dataDir: string;
let root: string;

// A fake engine standing in for the `runs` queue: enqueueRun records the run id
// instead of driving, so a test can assert approve returned without the drive
// running, then invoke the drive itself the way the worker would.
function fakeEngine(): { enqueued: string[] } & { enqueueRun(id: string): Promise<void> } {
  const enqueued: string[] = [];
  return {
    enqueued,
    async enqueueRun(id: string): Promise<void> {
      enqueued.push(id);
    },
  };
}

// Collect the hub events of the given types emitted while `body` runs.
async function captureEvents(types: string[], body: () => Promise<void>): Promise<KilnryEvent[]> {
  const seen: KilnryEvent[] = [];
  const off = eventHub.subscribe(({ event }: SequencedEvent) => {
    if (types.includes(event.type)) seen.push(event);
  });
  try {
    await body();
  } finally {
    off();
  }
  return seen;
}

async function seedRunAtCheckpoint(id: string): Promise<void> {
  await database.db.insert(runs).values({
    id,
    workflowId: 'kilnry-drive-demo',
    workflowVersion: '1.0.0',
    status: 'awaiting_approval',
    inputs: {},
    plan: PLAN,
    folder: `inbox/${id}`,
    estimateUsd: '0',
    source: 'workflow',
    createdAt: new Date(),
  });
  await database.db.insert(runSteps).values([
    {
      runId: id,
      stepId: 'gate',
      instanceId: 'gate',
      position: 0,
      name: 'Approve to render',
      kind: 'approval',
      status: 'waiting',
      approvalRequired: true,
    },
    {
      runId: id,
      stepId: 'done',
      instanceId: 'done',
      position: 1,
      name: 'done',
      kind: 'set',
      status: 'pending',
    },
  ]);
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'kilnry-drive-'));
  dataDir = join(root, 'data');
  mkdirSync(join(dataDir, 'workflows'), { recursive: true });
  writeFileSync(join(dataDir, 'workflows', 'kilnry-drive-demo.yaml'), WORKFLOW, 'utf8');
  writeFileSync(join(dataDir, 'workflows', 'kilnry-drive-soft.yaml'), SOFT_THEN_HARD, 'utf8');
  // loadConfig reads KILNRY_DATA_DIR; point it at the temp dir and leave the
  // Library root empty so the drive skips the manifest write.
  process.env.KILNRY_DATA_DIR = dataDir;
  database = createDatabase(dataDir, { memory: true });
  await database.ready;
}, 60_000);

afterAll(async () => {
  await closeDatabaseState(database);
  rmSync(root, { recursive: true, force: true });
});

beforeEach(async () => {
  await database.db.delete(runSteps);
  await database.db.delete(runs);
});

describe('event-driven run driving (F-WFL-06, TRD-12 §6)', () => {
  it('approve records the decision, enqueues one drive and returns before the drive runs', async () => {
    const id = 'run-approve-returns';
    await seedRunAtCheckpoint(id);
    const engine = fakeEngine();

    const returned = await approveRun(database, engine as never, id);

    // Approve returned the run as running, not completed — the drive has not run
    // (the fake only recorded the enqueue).
    expect(returned.status).toBe('running');
    expect(engine.enqueued).toEqual([id]);
    // The checkpoint is decided and persisted, so the enqueued drive will clear
    // it rather than pause again.
    const after = await getRun(database, id);
    const gate = after.steps.find((step) => step.step_id === 'gate');
    expect(gate?.status).toBe('completed');
    expect(after.status).toBe('running');
  });

  it('the drive finishes the run and emits run.updated with the terminal status (TRD-08 §13)', async () => {
    const id = 'run-drive-completes';
    await seedRunAtCheckpoint(id);
    const engine = fakeEngine();
    await approveRun(database, engine as never, id);

    const events = await captureEvents(['run.updated', 'run.awaiting'], async () => {
      await driveRunToRest(database, engine as never, dataDir, id);
    });

    const after = await getRun(database, id);
    expect(after.status).toBe('completed');
    const updated = events.find((event) => event.type === 'run.updated');
    expect(updated).toMatchObject({ type: 'run.updated', run_id: id, status: 'completed', spent_usd: 0 });
    expect(typeof (updated as { ts: string }).ts).toBe('string');
    // The run finished on approval, so no second checkpoint — no run.awaiting.
    expect(events.some((event) => event.type === 'run.awaiting')).toBe(false);
  });

  it('a run that reaches a checkpoint emits run.awaiting with the TRD-08 fields', async () => {
    const id = 'run-awaits';
    // A fresh run, not yet approved: the first drive stops at the gate.
    await database.db.insert(runs).values({
      id,
      workflowId: 'kilnry-drive-demo',
      workflowVersion: '1.0.0',
      status: 'running',
      inputs: {},
      plan: PLAN,
      folder: `inbox/${id}`,
      estimateUsd: '0',
      source: 'workflow',
      createdAt: new Date(),
    });
    const engine = fakeEngine();

    const events = await captureEvents(['run.awaiting', 'run.updated'], async () => {
      await driveRunToRest(database, engine as never, dataDir, id);
    });

    const after = await getRun(database, id);
    expect(after.status).toBe('awaiting_approval');
    const awaiting = events.find((event) => event.type === 'run.awaiting');
    expect(awaiting).toMatchObject({
      type: 'run.awaiting',
      run_id: id,
      step_id: 'gate',
      question: 'Approve to render',
      estimate_usd: 0,
    });
    expect(events.some((event) => event.type === 'run.updated')).toBe(false);
  });

  it('a drive that throws leaves the run failed with the reason on the live step', async () => {
    const id = 'run-drive-throws';
    // A run whose workflow is no longer installed: the drive throws NOT_FOUND
    // when it rebuilds, and driveRunToRest must record the failure, not escape.
    await database.db.insert(runs).values({
      id,
      workflowId: 'kilnry-missing-workflow',
      workflowVersion: '1.0.0',
      status: 'running',
      inputs: {},
      plan: PLAN,
      folder: `inbox/${id}`,
      estimateUsd: '0',
      source: 'workflow',
      createdAt: new Date(),
    });
    await database.db.insert(runSteps).values({
      runId: id,
      stepId: 'gate',
      instanceId: 'gate',
      position: 0,
      name: 'Approve to render',
      kind: 'approval',
      status: 'running',
    });
    const engine = fakeEngine();

    const events = await captureEvents(['run.updated'], async () => {
      await driveRunToRest(database, engine as never, dataDir, id);
    });

    const after = await getRun(database, id);
    expect(after.status).toBe('failed');
    const live = after.steps.find((step) => step.step_id === 'gate');
    expect(live?.status).toBe('failed');
    // getRun does not surface the step error, so read it from run_steps directly:
    // the reason the drive threw must be recorded on the live step (F-WFL-04).
    const [stepRow] = await database.db
      .select({ error: runSteps.error })
      .from(runSteps)
      .where(and(eq(runSteps.runId, id), eq(runSteps.instanceId, 'gate')));
    expect(stepRow?.error ?? '').toContain('kilnry-missing-workflow');
    const updated = events.find((event) => event.type === 'run.updated');
    expect(updated).toMatchObject({ type: 'run.updated', run_id: id, status: 'failed' });
  });

  it('two approves on one checkpoint drive once (singleton on the run id)', async () => {
    const id = 'run-double-approve';
    await seedRunAtCheckpoint(id);
    const engine = fakeEngine();

    await approveRun(database, engine as never, id);
    // The second approve finds no waiting step (the first decided it) and refuses,
    // so it never enqueues a second drive.
    await expect(approveRun(database, engine as never, id)).rejects.toThrow(/not waiting/i);

    expect(engine.enqueued).toEqual([id]);
  });

  it('skip_approvals drives through a soft gate but still pauses at a hard gate (TRD-12 §4)', async () => {
    const id = 'run-skip-soft';
    // A fresh soft-then-hard run whose persisted skip_approvals is true: the
    // drive clears the soft gate without pausing and stops at the hard gate.
    await database.db.insert(runs).values({
      id,
      workflowId: 'kilnry-drive-soft',
      workflowVersion: '1.0.0',
      status: 'running',
      inputs: {},
      plan: { ...PLAN, workflow_id: 'kilnry-drive-soft' },
      folder: `inbox/${id}`,
      estimateUsd: '0',
      source: 'workflow',
      skipApprovals: true,
      createdAt: new Date(),
    });
    const engine = fakeEngine();

    await driveRunToRest(database, engine as never, dataDir, id);

    const after = await getRun(database, id);
    expect(after.status).toBe('awaiting_approval');
    const soft = after.steps.find((step) => step.step_id === 'soft_gate');
    const mid = after.steps.find((step) => step.step_id === 'mid');
    const hard = after.steps.find((step) => step.step_id === 'hard_gate');
    // The soft gate did not hold the run (it auto-approved and completed); the
    // set after it ran; the hard gate is what the run now waits on.
    expect(soft?.status).toBe('completed');
    expect(mid?.status).toBe('completed');
    expect(hard?.status).toBe('waiting');
  });

  it('without skip_approvals the same run stops at the soft gate', async () => {
    const id = 'run-no-skip-soft';
    await database.db.insert(runs).values({
      id,
      workflowId: 'kilnry-drive-soft',
      workflowVersion: '1.0.0',
      status: 'running',
      inputs: {},
      plan: { ...PLAN, workflow_id: 'kilnry-drive-soft' },
      folder: `inbox/${id}`,
      estimateUsd: '0',
      source: 'workflow',
      skipApprovals: false,
      createdAt: new Date(),
    });
    const engine = fakeEngine();

    await driveRunToRest(database, engine as never, dataDir, id);

    const after = await getRun(database, id);
    expect(after.status).toBe('awaiting_approval');
    expect(after.steps.find((step) => step.step_id === 'soft_gate')?.status).toBe('waiting');
    expect(after.steps.find((step) => step.step_id === 'mid')?.status).toBe('pending');
  });
});

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDatabaseState, createDatabase, jobs, runSteps, runs } from '@kilnry/db';
import { eq } from 'drizzle-orm';
import {
  priceSheet,
  advanceSheetRun,
  approveSheetRun,
  denySheetRun,
  getSheetRun,
  startSheetRun,
  type SheetEngine,
  type SheetSink,
} from './sheet-run.js';

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose();
});

async function db(): Promise<Awaited<ReturnType<typeof createDatabase>>> {
  const root = mkdtempSync(join(tmpdir(), 'kilnry-sheetrun-'));
  const state = createDatabase(join(root, 'data'), { memory: true });
  disposers.push(async () => {
    await closeDatabaseState(state);
    rmSync(root, { recursive: true, force: true });
  });
  await state.ready;
  return state;
}

// A fake engine that hands back a job id, and a fake sink whose jobs are already
// complete so the run advances deterministically without a provider.
function fakes(state: Awaited<ReturnType<typeof db>>): {
  engine: SheetEngine;
  sink: SheetSink;
  registered: Array<{ view: string; anchor: string | null }>;
} {
  let counter = 0;
  const jobToAsset = new Map<string, string>();
  const registered: Array<{ view: string; anchor: string | null }> = [];
  const engine: SheetEngine = {
    async createJob() {
      counter += 1;
      const jobId = `job_${counter}`;
      // run_steps.job_id references jobs(id) (TRD-04 §3, F-82); the real engine
      // writes this row before it returns the id.
      await state.db.insert(jobs).values({ id: jobId, kind: 'image', source: 'ui', request: {} });
      jobToAsset.set(jobId, `asset_${counter}`);
      return { job_id: jobId, status: 'queued' };
    },
  };
  const sink: SheetSink = {
    async assetPath(assetId) {
      return `/library/${assetId}/sheet.png`;
    },
    async jobOutputs(jobId) {
      return { status: 'completed', assetIds: [jobToAsset.get(jobId) ?? 'asset_x'] };
    },
    async split(_input, outputs) {
      return outputs;
    },
    async registerView(input) {
      registered.push({ view: input.view, anchor: input.anchorAssetId });
      return `ref_${registered.length}`;
    },
  };
  return { engine, sink, registered };
}

describe('sheet run (F-CHR-04 minimal executor)', () => {
  it('runs the turnaround, registers the six views, then pauses for approval', async () => {
    const state = await db();
    const { engine, sink, registered } = fakes(state);
    const { run_id } = await startSheetRun(state, engine, {
      characterId: 'char_1',
      anchorAssetId: 'anchor_1',
      folder: 'People/maya',
      short: 'A calm woman.',
    });

    // Drive the machine until it reaches the approval checkpoint.
    let status = await advanceSheetRun(state, engine, sink, run_id);
    for (let i = 0; i < 10 && status === 'running'; i += 1) {
      status = await advanceSheetRun(state, engine, sink, run_id);
    }
    expect(status).toBe('awaiting_approval');

    // Six turnaround views registered with role reference and lineage to anchor.
    expect(registered.map((r) => r.view)).toEqual([
      'front',
      'three_quarter_left',
      'profile_left',
      'back',
      'three_quarter_right',
      'profile_right',
    ]);
    expect(registered.every((r) => r.anchor === 'anchor_1')).toBe(true);

    const run = await getSheetRun(state, run_id);
    expect(run.status).toBe('awaiting_approval');
    expect(run.steps.find((s) => s.kind === 'approval')?.status).toBe('waiting');
  });

  it('continues to the expression grid on approve', async () => {
    const state = await db();
    const { engine, sink } = fakes(state);
    const { run_id } = await startSheetRun(state, engine, {
      characterId: 'char_1',
      anchorAssetId: 'anchor_1',
      folder: 'People/maya',
      short: 'A calm woman.',
    });
    let status = await advanceSheetRun(state, engine, sink, run_id);
    for (let i = 0; i < 10 && status === 'running'; i += 1) {
      status = await advanceSheetRun(state, engine, sink, run_id);
    }
    expect(status).toBe('awaiting_approval');

    let after = await approveSheetRun(state, engine, sink, run_id);
    for (let i = 0; i < 10 && after === 'running'; i += 1) {
      after = await advanceSheetRun(state, engine, sink, run_id);
    }
    expect(after).toBe('completed');
    const run = await getSheetRun(state, run_id);
    expect(run.steps.find((s) => s.id === 'expressions')?.status).toBe('completed');
  });

  it('stops on deny and spends nothing more', async () => {
    const state = await db();
    const { engine, sink } = fakes(state);
    const { run_id } = await startSheetRun(state, engine, {
      characterId: 'char_1',
      anchorAssetId: 'anchor_1',
      folder: 'People/maya',
      short: 'x',
    });
    let status = await advanceSheetRun(state, engine, sink, run_id);
    for (let i = 0; i < 10 && status === 'running'; i += 1) {
      status = await advanceSheetRun(state, engine, sink, run_id);
    }
    expect(status).toBe('awaiting_approval');
    expect(await denySheetRun(state, run_id)).toBe('cancelled');
    const run = await getSheetRun(state, run_id);
    expect(run.steps.find((s) => s.id === 'expressions')?.status).toBe('cancelled');
  });
});

// F-112: a throwing first submission was swallowed, leaving a run that said
// "running" with no job behind it and no way to see why.
describe('a sheet whose first job cannot be submitted (F-112)', () => {
  it('marks the first generate step failed with the reason and fails the run', async () => {
    const state = await db();
    const { sink } = fakes(state);
    const refusing = {
      async createJob(): Promise<{ job_id: string; status: string }> {
        throw new Error('No connected provider offers image editing.');
      },
    };
    const started = await startSheetRun(state, refusing, {
      characterId: 'char_1',
      anchorAssetId: 'anchor_1',
      folder: 'People/maya',
      short: 'A woman in her 30s.',
    });
    const [run] = await state.db.select().from(runs).where(eq(runs.id, started.run_id));
    expect(run?.status).toBe('failed');
    const steps = await state.db.select().from(runSteps).where(eq(runSteps.runId, started.run_id));
    const first = steps.find((step) => step.stepId === started.steps.find((s) => s.kind === 'generate')?.id);
    expect(first?.status).toBe('failed');
    expect(first?.error).toBe('No connected provider offers image editing.');
    // A failed run is final: advancing it never skips past the failed step.
    await expect(advanceSheetRun(state, refusing, sink, started.run_id)).resolves.toBe('failed');
  });
});

describe('the sheet price before anything runs (F-112, PRD-07:278)', () => {
  it('sums the engine estimate of every generate step and writes nothing', async () => {
    const state = await db();
    const priced: Array<Record<string, unknown>> = [];
    const result = await priceSheet(
      async (request) => {
        priced.push(request);
        return 0.04;
      },
      { anchorAssetId: 'anchor_1', short: 'A woman in her 30s.' },
    );
    expect(result.generate_steps).toBe(priced.length);
    expect(result.generate_steps).toBeGreaterThan(0);
    expect(result.estimate_usd).toBeCloseTo(0.04 * priced.length, 6);
    expect(priced[0]).toMatchObject({ kind: 'image_edit', medias: [{ role: 'reference', ref: 'anchor_1' }] });
    expect(await state.db.select().from(runs)).toHaveLength(0);
  });
});

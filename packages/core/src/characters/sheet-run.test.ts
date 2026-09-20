// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDatabaseState, createDatabase } from '@kilnry/db';
import {
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
function fakes(): {
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
    const { engine, sink, registered } = fakes();
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
    const { engine, sink } = fakes();
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
    const { engine, sink } = fakes();
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

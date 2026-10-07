// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// F-64: PRD-10:91 — "denying marks remaining steps `skipped` and the run
// `cancelled` with completed outputs kept." The remaining steps were marked
// `cancelled`, which the run view's progress does not count, so a denied run's
// "n of m steps" never reached m.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDatabaseState, createDatabase, runSteps, runs } from '@kilnry/db';
import { progress, type RunView } from '../components/workflow-run-view-logic';
import { denyRun, getRun } from './workflows';

let database: ReturnType<typeof createDatabase>;
let root: string;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'kilnry-deny-run-'));
  database = createDatabase(join(root, 'data'), { memory: true });
  await database.ready;
}, 60_000);

afterAll(async () => {
  await closeDatabaseState(database);
  rmSync(root, { recursive: true, force: true });
}, 30_000);

describe('denying a checkpoint (F-WFL-04, F-64)', () => {
  it('skips the remaining steps, cancels the run, keeps completed outputs, and reads m of m', async () => {
    await database.db
      .insert(runs)
      .values({ id: 'run-1', workflowId: 'kilnry-thumbnail', status: 'waiting', inputs: {}, plan: {} });
    await database.db.insert(runSteps).values([
      {
        runId: 'run-1',
        stepId: 'concept',
        instanceId: 'concept',
        position: 0,
        name: 'Concept',
        kind: 'generate',
        status: 'completed',
        outputs: { asset: 'a1' },
      },
      {
        runId: 'run-1',
        stepId: 'pick',
        instanceId: 'pick',
        position: 1,
        name: 'Pick a framing',
        kind: 'approval',
        status: 'waiting',
      },
      {
        runId: 'run-1',
        stepId: 'scene',
        instanceId: 'scene',
        position: 2,
        name: 'Scene',
        kind: 'generate',
        status: 'pending',
      },
      {
        runId: 'run-1',
        stepId: 'export',
        instanceId: 'export',
        position: 3,
        name: 'Save the thumbnail',
        kind: 'export',
        status: 'pending',
      },
    ]);

    const state = await denyRun(database, 'run-1');
    expect(state.status).toBe('cancelled');

    const run = await getRun(database, 'run-1');
    expect(run.status).toBe('cancelled');
    expect(run.steps.map((step) => [step.step_id, step.status])).toEqual([
      ['concept', 'completed'],
      ['pick', 'denied'],
      ['scene', 'skipped'],
      ['export', 'skipped'],
    ]);
    expect(run.steps[0]?.outputs).toEqual({ assets: ['a1'] });
    expect(progress(run as unknown as RunView)).toEqual({ done: 4, total: 4, fraction: 1 });
  });
});

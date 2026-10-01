// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { parseWorkflow } from './parse.js';
import { plan, type PlanContext } from './planner.js';
import { execute, type Effects, type StepResult } from './executor.js';
import { buildManifest, MANIFEST_SCHEMA_VERSION, runFolder } from './manifest.js';

const WF = `
id: kilnry-ugc-ad
name: UGC ad
version: 1.2.0
category: ads
steps:
  - id: gen
    kind: generate
    capability: text2image
    prompt: "x"
    outputs: { asset: "{{ result.assets[0] }}" }
outputs:
  final: "{{ steps.gen.outputs.asset }}"
`;

const ctx: PlanContext = {
  resolveInputs: () => ({ folder: 'Client_A' }),
  priceStep: () => ({ model: 'fal/x', provider: 'fal', estimate_usd: 0.25, eta_s: 5, why: 'stub' }),
};

const effects: Effects = {
  runStep: async (): Promise<StepResult> => ({
    outputs: { asset: 'asset-1', assets: ['asset-1'] },
    actual_usd: 0.24,
    model: 'fal/x',
    provider: 'fal',
    job_id: 'job-abc',
    status: 'completed',
  }),
};

describe('run folder and manifest (F-WFL-09, TRD-12 §6.1)', () => {
  it('names the run folder <project>/<Workflow>_<date>', () => {
    const wf = parseWorkflow(WF);
    const folder = runFolder(wf, { project: 'Client_A', date: new Date('2026-09-18T11:20:00') });
    expect(folder).toBe('Client_A/UGC_ad_2026-09-18_1120');
  });

  it('falls back to inbox when no project is given', () => {
    const wf = parseWorkflow(WF);
    expect(runFolder(wf, { date: new Date('2026-09-18T09:05:00') })).toBe('inbox/UGC_ad_2026-09-18_0905');
  });

  it('suffixes a re-run folder with _rerunN beside its parent (F-WFL-05)', () => {
    const wf = parseWorkflow(WF);
    const base = { project: 'Client_A', date: new Date('2026-09-18T11:20:00') };
    // The first re-run is _rerun2, the next _rerun3; ordinal 1 and undefined add
    // no suffix so the original run keeps its plain name.
    expect(runFolder(wf, { ...base, rerun: 2 })).toBe('Client_A/UGC_ad_2026-09-18_1120_rerun2');
    expect(runFolder(wf, { ...base, rerun: 3 })).toBe('Client_A/UGC_ad_2026-09-18_1120_rerun3');
    expect(runFolder(wf, { ...base, rerun: 1 })).toBe('Client_A/UGC_ad_2026-09-18_1120');
  });

  it('records parent_run_id in a child run manifest (F31)', async () => {
    const wf = parseWorkflow(WF);
    const p = plan(wf, {}, ctx);
    p.id = 'plan_child';
    const state = await execute(wf, { inputs: {}, defaults: {}, vars: {} }, effects);
    const manifest = buildManifest({
      runId: 'run_child',
      parentRunId: 'run_parent',
      workflow: wf,
      plan: p,
      state,
      folder: 'Client_A/UGC_ad_2026-09-18_1120_rerun2',
      startedAt: '2026-09-18T12:00:00.000Z',
    });
    expect(manifest.parent_run_id).toBe('run_parent');
    expect(manifest.folder).toBe('Client_A/UGC_ad_2026-09-18_1120_rerun2');
    // A run with no parent omits the field rather than carrying undefined.
    const solo = buildManifest({
      runId: 'run_solo',
      workflow: wf,
      plan: p,
      state,
      folder: 'inbox/UGC_ad_2026-09-18_1120',
      startedAt: '2026-09-18T12:00:00.000Z',
    });
    expect('parent_run_id' in solo).toBe(false);
  });

  it('builds a manifest listing every step with actual cost', async () => {
    const wf = parseWorkflow(WF);
    const p = plan(wf, {}, ctx);
    p.id = 'plan_test1';
    const state = await execute(wf, { inputs: {}, defaults: {}, vars: {} }, effects);
    const manifest = buildManifest({
      runId: 'run_1',
      workflow: wf,
      plan: p,
      state,
      folder: 'Client_A/UGC_ad_2026-09-18_1120',
      startedAt: '2026-09-18T11:20:00.000Z',
      finishedAt: '2026-09-18T11:25:00.000Z',
      sha256: 'abc123',
      charactersUsed: [{ handle: 'maya', version: 2 }],
    });
    expect(manifest.schema_version).toBe(MANIFEST_SCHEMA_VERSION);
    expect(manifest.workflow).toEqual({ id: 'kilnry-ugc-ad', version: '1.2.0', sha256: 'abc123' });
    expect(manifest.spent_usd).toBeCloseTo(0.24, 6);
    // The plan id is distinct from the run id (F-WFL-09).
    expect(manifest.plan_id).toBe('plan_test1');
    // characters_used carries what the host supplied.
    expect(manifest.characters_used).toEqual([{ handle: 'maya', version: 2 }]);
    // The run-level outputs resolve the workflow's outputs.final to the asset.
    expect(manifest.outputs.final).toBe('asset-1');
    const gen = manifest.steps.find((step) => step.step_id === 'gen')!;
    expect(gen.actual_usd).toBeCloseTo(0.24, 6);
    expect(gen.estimate_usd).toBeCloseTo(0.25, 6);
    expect(gen.outputs.assets).toContainEqual({ asset_id: 'asset-1' });
    // The step carries its job id and the rendered prompt it ran with.
    expect(gen.job_id).toBe('job-abc');
    expect(gen.inputs.prompt).toBe('x');
  });
});

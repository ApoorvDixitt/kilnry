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

  it('builds a manifest listing every step with actual cost', async () => {
    const wf = parseWorkflow(WF);
    const p = plan(wf, {}, ctx);
    const state = await execute(wf, { inputs: {}, defaults: {}, vars: {} }, effects);
    const manifest = buildManifest({
      runId: 'run_1',
      workflow: wf,
      plan: p,
      state,
      folder: 'Client_A/UGC_ad_2026-09-18_1120',
      startedAt: '2026-09-18T11:20:00.000Z',
      finishedAt: '2026-09-18T11:25:00.000Z',
    });
    expect(manifest.schema_version).toBe(MANIFEST_SCHEMA_VERSION);
    expect(manifest.workflow).toEqual({ id: 'kilnry-ugc-ad', version: '1.2.0' });
    expect(manifest.spent_usd).toBeCloseTo(0.24, 6);
    const gen = manifest.steps.find((step) => step.step_id === 'gen')!;
    expect(gen.actual_usd).toBeCloseTo(0.24, 6);
    expect(gen.estimate_usd).toBeCloseTo(0.25, 6);
    expect(gen.outputs.assets).toContainEqual({ asset_id: 'asset-1' });
  });
});

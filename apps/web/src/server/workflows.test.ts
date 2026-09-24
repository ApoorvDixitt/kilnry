// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The workflow host runner money path (F-WFL-01/02/03, TRD-12 §6). A fake engine
// counts submits and ledger writes: driving the pure executor with effects that
// build their createJob input exactly as the server does proves one submit per
// spending step, each tagged source 'workflow' with the run and step id and the
// plan step's estimate as the confirmed cost, and that the executor never reaches
// a provider adapter.

import { describe, expect, it } from 'vitest';
import {
  execute,
  parseWorkflow,
  plan,
  renderStep,
  type Effects,
  type PlanContext,
  type RunStep,
  type Scope,
  type Step,
  type StepResult,
} from '@kilnry/workflows';
import { buildSpendInput } from './workflows';

const WF = `
id: kilnry-money-demo
name: Money demo
version: 1.0.0
category: ads
steps:
  - id: boards
    kind: foreach
    over: "{{ [0, 1] }}"
    steps:
      - id: board
        kind: generate
        capability: text2image
        prompt: "board {{ index }}"
        outputs: { asset: "{{ result.assets[0] }}" }
  - id: assemble
    kind: assemble
    op: concat
    inputs: ["{{ steps.boards.assets }}"]
  - id: clip
    kind: generate
    capability: reference2video
    prompt: "clip"
    depends_on: [assemble]
    outputs: { asset: "{{ result.assets[0] }}" }
`;

const planCtx: PlanContext = {
  resolveInputs: () => ({}),
  priceStep: (step: Step) => ({
    model: 'fal/x',
    provider: 'fal',
    estimate_usd: step.kind === 'generate' ? 0.25 : 0,
    eta_s: 5,
    why: 'stub',
  }),
};

describe('workflow host runner money path (F-WFL-01/02/03)', () => {
  it('submits one job per spending step, tagged source workflow with run and step id', async () => {
    const workflow = parseWorkflow(WF);
    const priced = plan(workflow, {}, planCtx);
    const scope: Scope = { inputs: {}, defaults: {}, vars: {} };

    const submits: Array<ReturnType<typeof buildSpendInput>> = [];
    let ledgerWrites = 0;

    // The fake engine stands in for JobEngine.createJob: it records the submit
    // (one ledger row per submit, as the real engine writes) and completes.
    const fakeCreateJob = (input: ReturnType<typeof buildSpendInput>): { assets: string[] } => {
      submits.push(input);
      ledgerWrites += 1;
      return { assets: [`asset-${submits.length}`] };
    };

    const effects: Effects = {
      runStep: async (node: RunStep, rendered: Step): Promise<StepResult> => {
        if (node.kind === 'generate') {
          const planStep = priced.steps.find((step) => step.step_id === node.step_id);
          const jobInput = buildSpendInput(
            'run_1',
            'Client_A/Money_demo_2026-09-18_1120',
            node,
            rendered,
            scope,
            planStep?.estimate_usd ?? 0,
          );
          const result = fakeCreateJob(jobInput);
          return {
            outputs: { asset: result.assets[0], assets: result.assets },
            actual_usd: jobInput.confirmed_cost_usd,
            status: 'completed',
          };
        }
        // assemble/set/export never spend and never submit.
        return { outputs: {}, actual_usd: 0, status: 'completed' };
      },
    };

    const state = await execute(workflow, scope, effects, { automatic: true });

    expect(state.status).toBe('completed');
    // 2 boards + 1 clip = 3 spending submits, and one ledger write each.
    expect(submits).toHaveLength(3);
    expect(ledgerWrites).toBe(3);
    for (const submit of submits) {
      expect(submit.request.source).toBe('workflow');
      expect(submit.run_id).toBe('run_1');
      expect(submit.step_id).toMatch(/board|clip/);
      expect(submit.confirmed_by).toBe('user');
      expect(submit.confirmed_cost_usd).toBeCloseTo(0.25, 6);
      expect(submit.request.target_folder).toBe('Client_A/Money_demo_2026-09-18_1120');
    }
  });

  it('buildSpendInput renders the step prompt and carries the client request id', () => {
    const workflow = parseWorkflow(WF);
    const scope: Scope = { inputs: {}, defaults: {}, vars: {} };
    // Reach the first board node by expanding via the executor with a no-op.
    const node: RunStep = {
      step_id: 'board',
      instance_id: 'boards[0].board',
      kind: 'generate',
      step: workflow.steps[0]!,
      status: 'pending',
      depends_on: [],
      scope_extra: { index: 0 },
      outputs: {},
      actual_usd: 0,
      attempts: 0,
      adjustments: [],
      approval: false,
    };
    const rendered = renderStep(
      {
        kind: 'generate',
        id: 'board',
        capability: 'text2image',
        prompt: 'board {{ index }}',
        model: 'auto',
        alternates: [],
        params: {},
        medias: [],
        characters: [],
        count: 1,
        depends_on: [],
        on_fail: 'fail',
        outputs: {},
        approval: false,
        timeout_s: 1800,
      } as unknown as Step,
      { index: 0 },
    );
    const input = buildSpendInput('run_9', 'inbox/x', node, rendered, scope, 0.5);
    expect(input.client_request_id).toBe('run_9:boards[0].board');
    expect(input.request.prompt).toContain('board');
    expect(input.request.source).toBe('workflow');
  });
});

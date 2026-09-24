// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { parseWorkflow } from './parse.js';
import { execute, resetFrom, type Effects, type RunStep, type StepResult } from './executor.js';

const WF = `
id: kilnry-exec-demo
name: Exec demo
version: 1.0.0
category: video
steps:
  - id: boards
    kind: foreach
    over: "{{ [0, 1] }}"
    steps:
      - id: board
        kind: generate
        capability: text2image
        prompt: "board {{ index }}"
        outputs: { asset: "board-{{ index }}" }
  - id: approve
    kind: approval
    mode: hard
    title: "Approve"
  - id: clip
    kind: generate
    capability: reference2video
    prompt: "clip"
    depends_on: [approve]
    outputs: { asset: "clip-1" }
`;

function completingEffects(overrides: Partial<Effects> = {}): Effects {
  return {
    runStep: async (node: RunStep): Promise<StepResult> => ({
      outputs: node.outputs,
      actual_usd: 0.25,
      model: 'stub/model',
      provider: 'fal',
      status: 'completed',
    }),
    ...overrides,
  };
}

describe('workflow executor (F-WFL-06d, TRD-12 §6)', () => {
  const scope = { inputs: {}, defaults: {}, vars: {} };

  it('pauses at a hard checkpoint until decided', async () => {
    const wf = parseWorkflow(WF);
    const state = await execute(wf, scope, completingEffects({ decide: () => 'wait' }));
    expect(state.status).toBe('awaiting_approval');
    // both board iterations ran; the clip after the checkpoint did not
    const ran = state.steps.filter((step) => step.status === 'completed' && step.kind === 'generate');
    expect(ran).toHaveLength(2);
    const clip = state.steps.find((step) => step.step_id === 'clip');
    expect(clip?.status).toBe('pending');
  });

  it('proceeds a soft checkpoint automatically and finishes', async () => {
    const soft = WF.replace('mode: hard', 'mode: soft');
    const wf = parseWorkflow(soft);
    const state = await execute(wf, scope, completingEffects(), { automatic: true });
    expect(state.status).toBe('completed');
    expect(state.spent_usd).toBeCloseTo(0.75, 6); // 2 boards + 1 clip
  });

  it('resumes after a decision is recorded', async () => {
    const wf = parseWorkflow(WF);
    let paused = await execute(wf, scope, completingEffects({ decide: () => 'wait' }));
    expect(paused.status).toBe('awaiting_approval');
    // Record the approval and resume.
    const gate = paused.steps.find((step) => step.step_id === 'approve')!;
    gate.status = 'completed';
    gate.outputs = { choice: 'approve' };
    paused = await execute(wf, scope, completingEffects(), {}, paused);
    expect(paused.status).toBe('completed');
  });

  it('retries a failed step then swaps to an alternate model', async () => {
    const wf = parseWorkflow(`
id: kilnry-retry
name: Retry
version: 1.0.0
category: image
steps:
  - id: gen
    kind: generate
    capability: text2image
    model: primary/model
    alternates: [backup/model]
    prompt: "x"
    retry: { max: 1, on: [PROVIDER_ERROR] }
    outputs: { asset: "a1" }
`);
    let calls = 0;
    const state = await execute(wf, scope, {
      runStep: async (): Promise<StepResult> => {
        calls += 1;
        // first two attempts fail, the alternate (third) completes
        if (calls < 3) return { outputs: {}, status: 'failed', error: 'PROVIDER_ERROR', retryable: true };
        return { outputs: { asset: 'a1' }, actual_usd: 0.1, model: 'backup/model', status: 'completed' };
      },
    });
    const gen = state.steps.find((step) => step.step_id === 'gen')!;
    expect(gen.status).toBe('completed');
    expect(gen.adjustments.some((note) => note.includes('model swapped to backup/model'))).toBe(true);
  });

  it('resetFrom re-pends a step and its dependants', async () => {
    const wf = parseWorkflow(WF.replace('mode: hard', 'mode: soft'));
    const state = await execute(wf, scope, completingEffects(), { automatic: true });
    expect(state.status).toBe('completed');
    resetFrom(state, 'approve', 'new/model');
    expect(state.status).toBe('running');
    expect(state.steps.find((step) => step.step_id === 'clip')?.status).toBe('pending');
  });
});

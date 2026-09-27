// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { parseWorkflow } from './parse.js';
import {
  execute,
  expandExportStep,
  resetFrom,
  type Effects,
  type ExpandedExportStep,
  type RunStep,
  type StepResult,
} from './executor.js';

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

// An `approval` marked on a working step is a gate in front of that step, not a
// substitute for it: PRD-10 §4 says the step pauses the run, and once approved the
// step still has to do its work. The four shipped workflows that mark a generate
// or analyze step this way used to have that step marked complete with the
// decision as its only output, producing no asset and spending nothing.
describe('an inline approval gates a step without replacing its work (F-WFL-04)', () => {
  const scope = { inputs: {}, defaults: {}, vars: {} };

  const GATED = (mode: 'hard' | 'soft'): string => `
id: kilnry-gated-demo
name: Gated demo
version: 1.0.0
category: image
steps:
  - id: anchor
    kind: generate
    capability: text2image
    prompt: "anchor"
    approval: ${mode}
    outputs: { asset: "{{ result.assets[0] }}" }
`;

  function producingEffects(counter: { runs: string[] }, overrides: Partial<Effects> = {}): Effects {
    return {
      runStep: async (node: RunStep): Promise<StepResult> => {
        counter.runs.push(node.step_id);
        return {
          outputs: { result: { assets: ['asset-anchor'] } },
          actual_usd: 0.19,
          model: 'stub/model',
          provider: 'fal',
          status: 'completed',
        };
      },
      ...overrides,
    };
  }

  it('waits at a hard gate without running the step', async () => {
    const counter = { runs: [] as string[] };
    const state = await execute(
      parseWorkflow(GATED('hard')),
      scope,
      producingEffects(counter, { decide: () => 'wait' }),
    );
    expect(state.status).toBe('awaiting_approval');
    expect(state.steps[0]?.status).toBe('waiting');
    expect(counter.runs).toEqual([]);
    expect(state.spent_usd).toBe(0);
  });

  it('runs the step itself once a hard gate is approved', async () => {
    const counter = { runs: [] as string[] };
    const state = await execute(
      parseWorkflow(GATED('hard')),
      scope,
      producingEffects(counter, { decide: () => 'approve' }),
    );
    expect(state.status).toBe('completed');
    expect(counter.runs).toEqual(['anchor']);
    // The step's declared output resolves from its own result, not from the
    // decision, so a downstream step can read the asset it produced.
    expect(state.steps[0]?.outputs).toMatchObject({ asset: 'asset-anchor' });
    expect(state.steps[0]?.outputs).not.toMatchObject({ choice: 'approve' });
    expect(state.spent_usd).toBeCloseTo(0.19, 6);
  });

  it('runs the step itself when a soft gate proceeds automatically', async () => {
    const counter = { runs: [] as string[] };
    const state = await execute(parseWorkflow(GATED('soft')), scope, producingEffects(counter), {
      automatic: true,
    });
    expect(state.status).toBe('completed');
    expect(counter.runs).toEqual(['anchor']);
    expect(state.steps[0]?.outputs).toMatchObject({ asset: 'asset-anchor' });
    expect(state.spent_usd).toBeCloseTo(0.19, 6);
  });

  it('runs the step after a paused gate is resumed with the decision recorded', async () => {
    const counter = { runs: [] as string[] };
    const wf = parseWorkflow(GATED('hard'));
    const paused = await execute(wf, scope, producingEffects(counter, { decide: () => 'wait' }));
    expect(paused.status).toBe('awaiting_approval');
    expect(counter.runs).toEqual([]);
    // The host records the decision the way approveRun does for a gated working
    // step: back to pending with the gate cleared, not completed.
    const gated = paused.steps[0]!;
    gated.status = 'pending';
    gated.approval_cleared = true;
    const resumed = await execute(wf, scope, producingEffects(counter), {}, paused);
    expect(resumed.status).toBe('completed');
    expect(counter.runs).toEqual(['anchor']);
    expect(resumed.steps[0]?.outputs).toMatchObject({ asset: 'asset-anchor' });
  });

  it('denying a gated step neither runs it nor spends', async () => {
    const counter = { runs: [] as string[] };
    const state = await execute(
      parseWorkflow(GATED('hard')),
      scope,
      producingEffects(counter, { decide: () => 'deny' }),
    );
    expect(state.steps[0]?.status).toBe('denied');
    expect(counter.runs).toEqual([]);
    expect(state.spent_usd).toBe(0);
  });

  it('a barrier approval step is still finished by approving it', async () => {
    const counter = { runs: [] as string[] };
    const state = await execute(
      parseWorkflow(WF),
      scope,
      producingEffects(counter, { decide: () => 'approve' }),
    );
    const gate = state.steps.find((step) => step.step_id === 'approve')!;
    expect(gate.status).toBe('completed');
    expect(gate.outputs).toMatchObject({ choice: 'approve' });
    // The barrier itself never reaches the step runner.
    expect(counter.runs).not.toContain('approve');
  });
});

describe('export step array expansion (F-WFL-09, TRD-12 §4)', () => {
  const EXPORT_WF = `
id: kilnry-export-demo
name: Export demo
version: 1.0.0
category: image
steps:
  - id: boards
    kind: foreach
    over: "{{ [0, 1, 2] }}"
    steps:
      - id: board
        kind: generate
        capability: text2image
        prompt: "board {{ index }}"
        outputs: { clean: "asset-{{ index }}" }
  - id: export
    kind: export
    files:
      - { ref: "{{ steps.boards.outputs }}", name: "board_{{ index + 1 | pad(2) }}.png", tags: [board] }
outputs:
  final: "{{ steps.boards.assets }}"
`;

  it('expands a foreach-produced array to one file per element with index bound', async () => {
    const workflow = parseWorkflow(EXPORT_WF);
    let exported: ExpandedExportStep | undefined;
    const effects: Effects = {
      decide: async (): Promise<'approve' | 'deny' | 'wait'> => 'approve',
      runStep: async (node: RunStep, rendered): Promise<StepResult> => {
        if (node.kind === 'export') {
          exported = rendered as ExpandedExportStep;
          return { outputs: { paths: [] }, actual_usd: 0, status: 'completed' };
        }
        const index = typeof node.scope_extra.index === 'number' ? node.scope_extra.index : 0;
        return {
          outputs: { clean: `asset-${index}`, result: { assets: [`asset-${index}`] } },
          actual_usd: 0,
          status: 'completed',
        };
      },
    };
    const state = await execute(workflow, { inputs: {}, defaults: {}, vars: {} }, effects, {
      automatic: true,
      skipApprovals: true,
    });
    expect(state.status).toBe('completed');
    expect(exported?.files).toHaveLength(3);
    expect(exported?.files.map((file) => file.name)).toEqual([
      'board_01.png',
      'board_02.png',
      'board_03.png',
    ]);
    expect(exported?.files.map((file) => file.ref)).toEqual(['asset-0', 'asset-1', 'asset-2']);
    for (const file of exported?.files ?? []) expect(file.tags).toEqual(['board']);
  });

  it('expandExportStep treats a scalar ref as a single file', () => {
    const step = {
      kind: 'export' as const,
      id: 'export',
      files: [{ ref: '{{ vars.master }}', name: 'final.mp4', tags: ['deliverable'] }],
      outputs: {},
    };
    const expanded = expandExportStep(step as never, {
      inputs: {},
      defaults: {},
      vars: { master: 'asset-final' },
    });
    expect(expanded.files).toHaveLength(1);
    expect(expanded.files[0]).toEqual({ ref: 'asset-final', name: 'final.mp4', tags: ['deliverable'] });
  });
});

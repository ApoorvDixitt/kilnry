// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { parseWorkflow } from './parse.js';
import type { Step } from './schema.js';
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

  it('routes a swapped model, not the original, on a re-run (F-WFL-05)', async () => {
    const wf = parseWorkflow(`
id: kilnry-swap-route
name: Swap route
version: 1.0.0
category: image
steps:
  - id: gen
    kind: generate
    capability: text2image
    model: primary/model
    prompt: "x"
    outputs: { asset: "a1" }
`);
    const seenModels: Array<string | undefined> = [];
    const effects: Effects = {
      runStep: async (_node: RunStep, rendered: Step | ExpandedExportStep): Promise<StepResult> => {
        seenModels.push((rendered as { model?: string }).model);
        return { outputs: { asset: 'a1' }, actual_usd: 0.1, status: 'completed' };
      },
    };
    // First run on the original model.
    let state = await execute(wf, scope, effects, { automatic: true });
    // Swap the model and re-run from the step.
    resetFrom(state, 'gen', 'swapped/model');
    state = await execute(wf, scope, effects, { automatic: true }, state);
    expect(state.status).toBe('completed');
    // The rendered step the effect saw carried the original first, then the swap
    // — proving the swap reaches the request rather than only the manifest note.
    expect(seenModels[0]).toBe('primary/model');
    expect(seenModels[seenModels.length - 1]).toBe('swapped/model');
  });

  it('numbers each retry attempt so it is a fresh request, not a replay (F-WFL-05)', async () => {
    const wf = parseWorkflow(`
id: kilnry-retry-attempts
name: Retry attempts
version: 1.0.0
category: image
steps:
  - id: gen
    kind: generate
    capability: text2image
    model: primary/model
    prompt: "x"
    retry: { max: 2, on: [PROVIDER_ERROR] }
    outputs: { asset: "a1" }
`);
    const seenAttempts: number[] = [];
    const state = await execute(wf, scope, {
      runStep: async (node: RunStep): Promise<StepResult> => {
        // The host keys the idempotency id off node.attempts; record it so we can
        // assert every attempt carried a distinct number rather than replaying.
        seenAttempts.push(node.attempts);
        if (node.attempts < 3) {
          return { outputs: {}, status: 'failed', error: 'PROVIDER_ERROR', retryable: true };
        }
        return { outputs: { asset: 'a1' }, actual_usd: 0.1, status: 'completed' };
      },
    });
    expect(state.steps.find((step) => step.step_id === 'gen')?.status).toBe('completed');
    // Three attempts (initial + two retries), each with a distinct, increasing
    // attempt number — so each produced a different client_request_id.
    expect(seenAttempts).toEqual([1, 2, 3]);
    expect(new Set(seenAttempts).size).toBe(seenAttempts.length);
  });

  it('resetFrom zeroes a re-run step so its spend is not double-counted (F-WFL-05)', async () => {
    const wf = parseWorkflow(WF.replace('mode: hard', 'mode: soft'));
    const state = await execute(wf, scope, completingEffects(), { automatic: true });
    expect(state.spent_usd).toBeCloseTo(0.75, 6); // 2 boards + 1 clip at 0.25

    // Reset from the checkpoint: the clip after it re-pends and its 0.25 leaves
    // the run total and the node.
    resetFrom(state, 'approve');
    const clip = state.steps.find((step) => step.step_id === 'clip')!;
    expect(clip.actual_usd).toBe(0);
    expect(state.spent_usd).toBeCloseTo(0.5, 6); // only the two boards remain

    // Re-running adds the clip's cost exactly once, not on top of the old one.
    const resumed = await execute(wf, scope, completingEffects(), { automatic: true }, state);
    expect(resumed.status).toBe('completed');
    expect(resumed.spent_usd).toBeCloseTo(0.75, 6);
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

  // The six executor and planner behaviours 5e7a502 carried without a named test
  // each (F-WFL-06). One focused case per behaviour, driving the pure executor.
  describe('5e7a502 executor and planner behaviours (F-WFL-06)', () => {
    const scope = { inputs: {}, defaults: {}, vars: {} };

    it('evaluates a step declared output against its result for a downstream step to read', async () => {
      // `probe` declares `dur` from its result; `use` reads steps.probe.outputs.dur.
      const wf = parseWorkflow(`
id: kilnry-decl-out
name: Declared out
version: 1.0.0
category: video
steps:
  - id: probe
    kind: assemble
    op: probe
    inputs: ["asset-1"]
    outputs: { dur: "{{ result.duration_s }}" }
  - id: use
    kind: generate
    capability: text2image
    depends_on: [probe]
    prompt: "duration was {{ steps.probe.outputs.dur }}"
    outputs: { asset: "used" }
`);
      let usePrompt = '';
      const effects: Effects = {
        runStep: async (node, rendered): Promise<StepResult> => {
          if (node.step_id === 'probe')
            return { outputs: { duration_s: 7 }, actual_usd: 0, status: 'completed' };
          if (node.step_id === 'use') usePrompt = (rendered as Extract<Step, { kind: 'generate' }>).prompt;
          return { outputs: { asset: 'used' }, actual_usd: 0.1, status: 'completed' };
        },
      };
      const state = await execute(wf, scope, effects, { automatic: true });
      expect(state.status).toBe('completed');
      // The declared output `dur` resolved from the probe result and rendered into
      // the downstream prompt.
      expect(usePrompt).toBe('duration was 7');
      expect(Number(state.steps.find((s) => s.step_id === 'probe')?.outputs.dur)).toBe(7);
    });

    it('aggregates a foreach container so a later step reads its iterations', async () => {
      // `boards` runs twice; `pick` reads steps.boards.outputs (the aggregate) and
      // steps.boards.assets (the flattened asset list).
      const wf = parseWorkflow(`
id: kilnry-agg
name: Aggregate
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
        outputs: { asset: "asset-{{ index }}" }
  - id: pick
    kind: generate
    capability: text2image
    depends_on: [boards]
    prompt: "from {{ len(steps.boards.outputs) }} boards"
    outputs: { asset: "picked" }
`);
      let pickPrompt = '';
      const effects: Effects = {
        runStep: async (node, rendered): Promise<StepResult> => {
          if (node.step_id === 'pick') pickPrompt = (rendered as Extract<Step, { kind: 'generate' }>).prompt;
          const index = typeof node.scope_extra.index === 'number' ? node.scope_extra.index : 0;
          return {
            outputs: { asset: `asset-${index}`, result: { assets: [`asset-${index}`] } },
            actual_usd: 0.1,
            status: 'completed',
          };
        },
      };
      const state = await execute(wf, scope, effects, { automatic: true });
      expect(state.status).toBe('completed');
      // The container aggregated its three iterations' assets, read by the later step.
      expect(pickPrompt).toBe('from 3 boards');
    });

    it('evaluates a branch condition only once its dependencies are ready, not during expansion', async () => {
      // The branch's `when` reads steps.gate.outputs.ok, which only exists after
      // gate runs; eager evaluation at expansion would throw or read undefined.
      const wf = parseWorkflow(`
id: kilnry-lazy-branch
name: Lazy branch
version: 1.0.0
category: image
steps:
  - id: gate
    kind: analyze
    task: describe
    instructions: "check"
    outputs: { ok: "{{ result.structured.ok }}" }
  - id: guarded
    kind: branch
    when: "{{ steps.gate.outputs.ok }}"
    then:
      - id: yes_step
        kind: generate
        capability: text2image
        prompt: "ran"
        outputs: { asset: "yes" }
    else: []
`);
      const effects: Effects = {
        runStep: async (node): Promise<StepResult> => {
          if (node.step_id === 'gate')
            return {
              outputs: { result: { structured: { ok: true } } },
              actual_usd: 0.05,
              status: 'completed',
            };
          return { outputs: { asset: 'yes' }, actual_usd: 0.1, status: 'completed' };
        },
      };
      const state = await execute(wf, scope, effects, { automatic: true });
      expect(state.status).toBe('completed');
      // The then-side ran because the gate's ok resolved true at run time.
      expect(state.steps.some((s) => s.step_id === 'yes_step' && s.status === 'completed')).toBe(true);
    });

    it('does not treat a step referencing its own enclosing foreach as a self-dependency', async () => {
      // A child step whose template mentions its container id must not deadlock
      // waiting on the container it lives in.
      const wf = parseWorkflow(`
id: kilnry-self-dep
name: Self dep
version: 1.0.0
category: image
steps:
  - id: shots
    kind: foreach
    over: "{{ [0, 1] }}"
    steps:
      - id: shot
        kind: generate
        capability: text2image
        prompt: "shot {{ index }} of shots"
        outputs: { asset: "shot-{{ index }}" }
`);
      const effects: Effects = {
        runStep: async (node): Promise<StepResult> => ({
          outputs: { asset: `shot-${node.scope_extra.index ?? 0}` },
          actual_usd: 0.1,
          status: 'completed',
        }),
      };
      const state = await execute(wf, scope, effects, { automatic: true });
      // Both iterations completed; no self-deadlock left a shot pending.
      expect(state.status).toBe('completed');
      expect(
        state.steps.filter((s) => s.instance_id.startsWith('shots[') && s.status === 'completed'),
      ).toHaveLength(2);
    });

    it('resolves a dependency on an undeclared foreach container id through byStepId', async () => {
      // `after` depends on `shots` — the container id, which is not a node itself;
      // it must resolve to the container's child instances being done.
      const wf = parseWorkflow(`
id: kilnry-container-dep
name: Container dep
version: 1.0.0
category: image
steps:
  - id: shots
    kind: foreach
    over: "{{ [0, 1] }}"
    steps:
      - id: shot
        kind: generate
        capability: text2image
        prompt: "shot {{ index }}"
        outputs: { asset: "shot-{{ index }}" }
  - id: after
    kind: generate
    capability: text2image
    depends_on: [shots]
    prompt: "after the shots"
    outputs: { asset: "after" }
`);
      const order: string[] = [];
      const effects: Effects = {
        runStep: async (node): Promise<StepResult> => {
          order.push(node.step_id);
          return { outputs: { asset: node.step_id }, actual_usd: 0.1, status: 'completed' };
        },
      };
      const state = await execute(wf, scope, effects, { automatic: true });
      expect(state.status).toBe('completed');
      // `after` ran, and only after both container children — the container-id
      // dependency resolved through the child instances.
      const afterIndex = order.indexOf('after');
      expect(afterIndex).toBeGreaterThan(-1);
      expect(order.filter((id) => id === 'shot').length).toBe(2);
      expect(order.slice(0, afterIndex).filter((id) => id === 'shot').length).toBe(2);
    });

    it("keeps a branch's kept side when the planner's whenHolds tolerates an unresolved condition", async () => {
      // A branch whose condition reads a not-yet-run step's output is kept
      // (conditional) at plan time rather than dropped, so it can run later.
      const wf = parseWorkflow(`
id: kilnry-when-holds
name: When holds
version: 1.0.0
category: image
steps:
  - id: score
    kind: analyze
    task: describe
    instructions: "score"
    outputs: { pass: "{{ result.structured.pass }}" }
  - id: refine
    kind: branch
    when: "{{ steps.score.outputs.pass == false }}"
    then:
      - id: redo
        kind: generate
        capability: text2image
        prompt: "redo"
        outputs: { asset: "redo" }
    else: []
`);
      const effects: Effects = {
        runStep: async (node): Promise<StepResult> => {
          if (node.step_id === 'score')
            return {
              outputs: { result: { structured: { pass: false } } },
              actual_usd: 0.05,
              status: 'completed',
            };
          return { outputs: { asset: 'redo' }, actual_usd: 0.1, status: 'completed' };
        },
      };
      const state = await execute(wf, scope, effects, { automatic: true });
      expect(state.status).toBe('completed');
      // The condition held at run time (pass == false), so the redo ran.
      expect(state.steps.some((s) => s.step_id === 'redo' && s.status === 'completed')).toBe(true);
    });
  });
});

// D-61 (TRD-12 §5): a model swap that raises a step's estimate more than 10 %
// above the planned figure pauses with both figures and the new run total, in
// every autonomy mode; at or below the threshold it proceeds and notes the delta.
describe('a price-raising model swap asks first (D-61, F-WFL-05)', () => {
  const scope = { inputs: {}, defaults: {}, vars: {} };
  const SWAP_WF = `
id: kilnry-swap-price
name: Swap price
version: 1.0.0
category: video
steps:
  - id: edit
    kind: generate
    capability: video2video
    model: cheap/model
    alternates: [dear/model]
    prompt: "x"
    outputs: { asset: "a1" }
`;
  function swapEffects(alternateUsd: number, decide?: Effects['decide']) {
    const ran: Array<string | undefined> = [];
    const effects: Effects = {
      runStep: async (_node: RunStep, rendered: Step | ExpandedExportStep): Promise<StepResult> => {
        const model = (rendered as { model?: string }).model;
        ran.push(model);
        if (model === 'cheap/model')
          return { outputs: {}, status: 'failed', error: 'PROVIDER_ERROR', retryable: true };
        return {
          outputs: { asset: 'a1' },
          actual_usd: alternateUsd,
          ...(model ? { model } : {}),
          status: 'completed',
        };
      },
      planned: () => ({ step_usd: 0.15, run_total_usd: 0.3 }),
      estimate: async (_node, rendered) =>
        (rendered as { model?: string }).model === 'dear/model' ? alternateUsd : 0.15,
      ...(decide ? { decide } : {}),
    };
    return { effects, ran };
  }

  it('pauses before the alternate runs when it costs more than 10 % over the plan, even automatically', async () => {
    const wf = parseWorkflow(SWAP_WF);
    const { effects, ran } = swapEffects(0.75, () => 'wait');
    const state = await execute(wf, scope, effects, { automatic: true, skipApprovals: true });
    expect(state.status).toBe('awaiting_approval');
    const edit = state.steps.find((step) => step.step_id === 'edit')!;
    expect(edit.status).toBe('waiting');
    expect(edit.pending_swap).toEqual({
      from: 'cheap/model',
      to: 'dear/model',
      planned_usd: 0.15,
      estimate_usd: 0.75,
      run_total_usd: 0.9,
    });
    expect(edit.model).toBe('dear/model');
    expect(ran).toEqual(['cheap/model']); // the dear model was never called
  });

  it('runs the swapped model once the owner approves it', async () => {
    const wf = parseWorkflow(SWAP_WF);
    const { effects, ran } = swapEffects(0.75, () => 'approve');
    const state = await execute(wf, scope, effects, {});
    expect(state.status).toBe('completed');
    expect(ran).toEqual(['cheap/model', 'dear/model']);
    expect(state.steps[0]!.pending_swap).toBeUndefined();
  });

  it('proceeds at or below 10 % and writes the delta into adjustments', async () => {
    const wf = parseWorkflow(SWAP_WF);
    const { effects, ran } = swapEffects(0.16, () => 'wait');
    const state = await execute(wf, scope, effects, {});
    expect(state.status).toBe('completed');
    expect(ran).toEqual(['cheap/model', 'dear/model']);
    const notes = state.steps[0]!.adjustments.join(' | ');
    expect(notes).toContain('model swap to dear/model within 10 %: step ≈ $0.15 → ≈ $0.16 (+$0.01)');
  });
});

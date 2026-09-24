// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { parseWorkflow } from './parse.js';
import { plan, type PlanContext } from './planner.js';
import type { Step } from './schema.js';

// A stub context: inputs pass through with defaults applied by hand, and every
// spending step is priced at a flat rate so the total is predictable.
function stubContext(inputs: Record<string, unknown>): PlanContext {
  return {
    resolveInputs: () => inputs,
    priceStep: (step: Step) => ({
      model: 'stub/model',
      provider: 'fal',
      estimate_usd: step.kind === 'generate' ? 0.25 : 0.01,
      eta_s: 5,
      why: 'stub',
    }),
  };
}

const WF = `
id: kilnry-plan-demo
name: Plan demo
version: 1.0.0
category: video
requires: [text2image, reference2video]
budget: { max_usd: 2, warn_usd: 1 }
steps:
  - id: setup
    kind: set
    values:
      n: "{{ 3 }}"
  - id: boards
    kind: foreach
    over: "{{ range(0, vars.n) }}"
    steps:
      - id: board
        kind: generate
        capability: text2image
        prompt: "board {{ index }}"
        outputs: { asset: "{{ result.assets[0] }}" }
  - id: approve
    kind: approval
    title: "Approve boards"
  - id: final
    kind: generate
    capability: reference2video
    prompt: "assemble"
    outputs: { asset: "{{ result.assets[0] }}" }
outputs:
  final: "{{ steps.final.outputs.asset }}"
`;

describe('workflow planner (F-WFL-06c, TRD-12 §4–5)', () => {
  it('evaluates vars, expands foreach and prices every spending leaf', () => {
    const wf = parseWorkflow(WF);
    const p = plan(wf, {}, stubContext({}));
    // 3 board generates + 1 final generate = 4 spending steps at 0.25 each = 1.00
    expect(p.vars.n).toBe(3);
    expect(p.expansions).toContainEqual({ step_id: 'boards', n: 3 });
    const spending = p.steps.filter((step) => step.kind === 'generate');
    expect(spending).toHaveLength(4);
    expect(p.total_estimate_usd).toBeCloseTo(1.0, 6);
  });

  it('marks the approval checkpoint and stays under the warn budget', () => {
    const wf = parseWorkflow(WF);
    const p = plan(wf, {}, stubContext({}));
    const approval = p.steps.find((step) => step.kind === 'approval');
    expect(approval?.approval).toBe(true);
    // total 1.00 == warn_usd 1, not over; > warn only when strictly greater
    expect(p.warnings).not.toContain('over_workflow_max');
  });

  it('warns when a step has no provider', () => {
    const wf = parseWorkflow(WF);
    const ctx: PlanContext = {
      resolveInputs: () => ({}),
      priceStep: () => ({ estimate_usd: 0, eta_s: 0, why: 'no provider connected' }),
    };
    const p = plan(wf, {}, ctx);
    expect(p.warnings.some((warning) => warning.startsWith('step '))).toBe(true);
  });
});

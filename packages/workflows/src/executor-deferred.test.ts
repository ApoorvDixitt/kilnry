// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Lazy foreach expansion over a step output (TRD-12 §5 foreach). A foreach whose
// `over` reads a step output cannot be counted until that step runs, so the
// executor emits a deferred placeholder and expands it in the loop. The hard
// part is resume: a fresh graph holds only the placeholder, so after a pause the
// container's children — and therefore `steps.<id>.outputs` and
// `steps.<id>.assets` that a later step reads — would be gone. These tests fail
// if a deferred container is not rebuilt to the exact shape an eager one has:
// the first reads the container's flattened assets from a later top-level step,
// the second from inside a sibling foreach's iteration (the faceless shape), and
// both do it across a pause-and-resume, which is where the real run broke.

import { describe, expect, it } from 'vitest';
import { parseWorkflow } from './parse.js';
import {
  execute,
  expandRunState,
  rehydrateDeferred,
  type Effects,
  type RunState,
  type RunStep,
  type StepResult,
} from './executor.js';

const scope = { inputs: {}, defaults: {}, vars: {} };

// Each step answers an asset named after its instance and records what it read,
// so a test can assert which value a later step was given. The analyze step
// returns a roster and a block list so the two deferred foreaches have something
// to expand over.
function effects(): Effects & { seen: Map<string, unknown> } {
  const seen = new Map<string, unknown>();
  return {
    seen,
    runStep: async (node: RunStep, rendered): Promise<StepResult> => {
      seen.set(node.instance_id, (rendered as { prompt?: unknown }).prompt);
      if (node.step_id === 'script') {
        return {
          outputs: {
            result: {
              structured: {
                roster: [
                  { kind: 'location', name: 'valley' },
                  { kind: 'prop', name: 'river' },
                ],
                blocks: [{ line: 'L1' }, { line: 'L2' }, { line: 'L3' }],
              },
            },
          },
          actual_usd: 0,
          status: 'completed',
        };
      }
      const asset = `asset:${node.instance_id}`;
      return {
        outputs: { asset, assets: [asset], result: { assets: [asset] } },
        actual_usd: 0,
        status: 'completed',
      };
    },
  };
}

// Rebuild the way the host does on resume: a fresh graph (only placeholders for
// deferred foreaches), each node's status and outputs overlaid from the paused
// state by instance id, then the deferred children reconstructed and overlaid
// too. This is exactly rebuildRunState's sequence, kept here so the executor's
// own contract is tested without the database.
function resumeFrom(paused: RunState, workflow: ReturnType<typeof parseWorkflow>): RunState {
  const byId = new Map(paused.steps.map((node) => [node.instance_id, node] as const));
  const state = expandRunState(workflow, scope);
  const overlay = (node: RunStep): void => {
    const row = byId.get(node.instance_id);
    if (!row) return;
    node.status = row.status;
    node.outputs = row.outputs;
    if (row.approval_cleared) node.approval_cleared = true;
  };
  for (const node of state.steps) overlay(node);
  const before = new Set(state.steps.map((node) => node.instance_id));
  rehydrateDeferred(state, scope);
  for (const node of state.steps) if (!before.has(node.instance_id)) overlay(node);
  return state;
}

describe('deferred foreach over a step output, across resume', () => {
  it('a later top-level step reads the rebuilt container assets after resume', async () => {
    const workflow = parseWorkflow(`
id: kilnry-deferred-later
name: Deferred later
version: 1.0.0
category: video
steps:
  - id: script
    kind: analyze
    task: describe
    outputs: { roster: "{{ result.structured.roster }}" }
  - id: assets
    kind: foreach
    over: "{{ steps.script.outputs.roster }}"
    as: item
    steps:
      - id: asset_gen
        kind: generate
        capability: text2image
        prompt: "make {{ item.name }}"
        outputs: { asset: "{{ result.assets[0] }}", kind: "{{ item.kind }}" }
  - id: gate
    kind: approval
    mode: hard
    title: "Approve"
    depends_on: [assets]
  - id: compose
    kind: generate
    capability: image_edit
    prompt: "compose from {{ len(steps.assets.assets) }} refs {{ steps.assets.assets }}"
    depends_on: [gate]
    outputs: { asset: "{{ result.assets[0] }}" }
`);
    const paused = await execute(workflow, scope, effects(), {});
    expect(paused.status).toBe('awaiting_approval');

    const rebuilt = resumeFrom(paused, workflow);
    const gate = rebuilt.steps.find((node) => node.instance_id === 'gate')!;
    gate.status = 'pending';
    gate.approval_cleared = true;
    const run = effects();
    const resumed = await execute(workflow, scope, { ...run, decide: () => 'approve' }, {}, rebuilt);

    expect(resumed.status).toBe('completed');
    // The container exposed both its iterations' assets after resume, so compose
    // read a two-element array — not undefined, which is what a lost deferred
    // container produced.
    expect(run.seen.get('compose')).toBe(
      'compose from 2 refs ["asset:assets[0].asset_gen","asset:assets[1].asset_gen"]',
    );
  });

  it('a sibling foreach iteration reads the rebuilt container assets after resume (faceless shape)', async () => {
    const workflow = parseWorkflow(`
id: kilnry-deferred-sibling
name: Deferred sibling
version: 1.0.0
category: video
steps:
  - id: script
    kind: analyze
    task: describe
    outputs: { roster: "{{ result.structured.roster }}", blocks: "{{ result.structured.blocks }}" }
  - id: assets
    kind: foreach
    over: "{{ steps.script.outputs.roster }}"
    as: item
    steps:
      - id: asset_gen
        kind: generate
        capability: text2image
        prompt: "make {{ item.name }}"
        outputs: { asset: "{{ result.assets[0] }}", kind: "{{ item.kind }}" }
  - id: gate
    kind: approval
    mode: hard
    title: "Approve"
    depends_on: [assets]
  - id: stills
    kind: foreach
    over: "{{ steps.script.outputs.blocks }}"
    as: block
    depends_on: [gate]
    steps:
      - id: still_gen
        kind: generate
        capability: image_edit
        prompt: "frame {{ block.line }} from {{ len(steps.assets.assets) }} refs {{ steps.assets.assets | take(1) }}"
        outputs: { asset: "{{ result.assets[0] }}" }
`);
    const paused = await execute(workflow, scope, effects(), {});
    expect(paused.status).toBe('awaiting_approval');

    const rebuilt = resumeFrom(paused, workflow);
    const gate = rebuilt.steps.find((node) => node.instance_id === 'gate')!;
    gate.status = 'pending';
    gate.approval_cleared = true;
    const run = effects();
    const resumed = await execute(workflow, scope, { ...run, decide: () => 'approve' }, {}, rebuilt);

    expect(resumed.status).toBe('completed');
    // Every stills iteration ran — the sibling deferred container (assets) was
    // whole for each one. Before the rebuild, stills[0].still_gen threw
    // "expected an array, got undefined" on steps.assets.assets.
    expect(run.seen.get('stills[0].still_gen')).toBe('frame L1 from 2 refs ["asset:assets[0].asset_gen"]');
    expect(run.seen.get('stills[1].still_gen')).toBe('frame L2 from 2 refs ["asset:assets[0].asset_gen"]');
    expect(run.seen.get('stills[2].still_gen')).toBe('frame L3 from 2 refs ["asset:assets[0].asset_gen"]');
  });
});

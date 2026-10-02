// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Run-time `set` (TRD-12 §6: "set → evaluate, store outputs, complete"). These
// would fail if the executor left a set to the host or evaluated it only at plan
// time: a var read from an earlier step's output would be empty, and the run's
// outputs.final would not name the step that produced it.

import { describe, expect, it } from 'vitest';
import { parseWorkflow } from './parse.js';
import type { Step } from './schema.js';
import { buildManifest } from './manifest.js';
import { execute, type Effects, type RunStep, type StepResult } from './executor.js';

const scope = { inputs: {}, defaults: {}, vars: {} };

// Each spending or local step answers an asset named after its instance, and
// records what it was given, so a test can see which var value a step read.
function recordingEffects(): Effects & { seen: Map<string, unknown> } {
  const seen = new Map<string, unknown>();
  return {
    seen,
    runStep: async (node: RunStep, rendered): Promise<StepResult> => {
      seen.set(
        node.instance_id,
        (rendered as { inputs?: unknown; prompt?: unknown }).inputs ??
          (rendered as { prompt?: unknown }).prompt,
      );
      const asset = `asset:${node.instance_id}`;
      return {
        outputs: { asset, assets: [asset], result: { asset_id: asset } },
        actual_usd: 0,
        status: 'completed',
      };
    },
  };
}

// The ugc-ad shape: a clips loop, a concat over the loop's merged assets, a
// top-level set reading the concat's output, and a burn reading the var.
const UGC_SHAPE = `
id: kilnry-set-ugc-shape
name: Set ugc shape
version: 1.0.0
category: video
steps:
  - id: clips
    kind: foreach
    over: "{{ [0, 1] }}"
    steps:
      - id: clip
        kind: generate
        capability: text2video
        prompt: "clip {{ index }}"
        outputs: { asset: "{{ result.asset_id }}" }
  - id: assemble
    kind: assemble
    op: concat
    inputs: "{{ steps.clips.assets }}"
    outputs: { asset: "{{ result.asset_id }}" }
  - id: cut
    kind: set
    values:
      master: "{{ steps.assemble.outputs.asset }}"
      count: "{{ len(steps.clips.assets) }}"
  - id: burn
    kind: assemble
    op: burn_captions
    inputs: ["{{ vars.master }}"]
    outputs: { asset: "{{ result.asset_id }}" }
outputs:
  final: "{{ steps.burn.outputs.asset | default(vars.master) }}"
`;

describe('run-time set steps (F-WFL-06, TRD-12 §6)', () => {
  it('a top-level set reads a step after a foreach, and later steps and outputs.final read its var', async () => {
    const workflow = parseWorkflow(UGC_SHAPE);
    const effects = recordingEffects();
    const state = await execute(workflow, scope, effects, { automatic: true });
    expect(state.status).toBe('completed');
    expect(state.vars?.['']).toEqual({ master: 'asset:assemble', count: 2 });
    // burn ran with the var the set stored, not an empty string.
    expect(effects.seen.get('burn')).toEqual(['asset:assemble']);
    const manifest = buildManifest({
      runId: 'run_1',
      workflow,
      plan: { inputs: {}, vars: {}, total_estimate_usd: 0, steps: [] } as never,
      state,
      folder: 'inbox/Set_shape',
      startedAt: '2026-10-02T00:00:00.000Z',
    } as never);
    expect(manifest.vars).toMatchObject({ master: 'asset:assemble', count: 2 });
    expect(manifest.outputs.final).toBe('asset:burn');
  });

  it('a set inside a foreach stores per-iteration vars and reads its own iteration siblings', async () => {
    const workflow = parseWorkflow(`
id: kilnry-set-foreach-shape
name: Set foreach shape
version: 1.0.0
category: video
steps:
  - id: dubs
    kind: foreach
    over: "{{ ['es', 'fr'] }}"
    as: lang
    steps:
      - id: tts
        kind: generate
        capability: tts
        prompt: "speak {{ lang }}"
        outputs: { asset: "{{ result.asset_id }}" }
      - id: track
        kind: set
        values: { audio: "{{ steps.tts.outputs.asset }}" }
      - id: mux
        kind: assemble
        op: mux_audio
        inputs: ["{{ vars.audio }}"]
        outputs: { asset: "{{ result.asset_id }}" }
`);
    const effects = recordingEffects();
    const state = await execute(workflow, scope, effects, { automatic: true });
    expect(state.status).toBe('completed');
    expect(state.vars?.['dubs[0].']).toEqual({ audio: 'asset:dubs[0].tts' });
    expect(state.vars?.['dubs[1].']).toEqual({ audio: 'asset:dubs[1].tts' });
    expect(effects.seen.get('dubs[0].mux')).toEqual(['asset:dubs[0].tts']);
    expect(effects.seen.get('dubs[1].mux')).toEqual(['asset:dubs[1].tts']);
  });

  it('fails a set whose step was skipped, naming the missing path, instead of storing an empty var', async () => {
    const workflow = parseWorkflow(`
id: kilnry-set-skipped
name: Set skipped
version: 1.0.0
category: video
steps:
  - id: optional
    kind: generate
    capability: text2image
    prompt: "maybe"
    when: "{{ false }}"
  - id: pick
    kind: set
    values: { chosen: "{{ steps.optional.outputs.asset }}" }
  - id: use
    kind: assemble
    op: concat
    inputs: ["{{ vars.chosen }}"]
`);
    const effects = recordingEffects();
    const state = await execute(workflow, scope, effects, { automatic: true });
    const pick = state.steps.find((node) => node.instance_id === 'pick')!;
    expect(pick.status).toBe('failed');
    expect(pick.error).toContain('chosen did not resolve: steps.optional.outputs.asset has no value');
    expect(state.status).toBe('failed');
    expect(effects.seen.has('use')).toBe(false);
  });

  it('restores run-time vars from completed set steps when a paused run resumes', async () => {
    const workflow = parseWorkflow(`
id: kilnry-set-resume
name: Set resume
version: 1.0.0
category: video
steps:
  - id: board
    kind: generate
    capability: text2image
    prompt: "board"
    outputs: { asset: "{{ result.asset_id }}" }
  - id: keep
    kind: set
    values: { hero: "{{ steps.board.outputs.asset }}" }
  - id: gate
    kind: approval
    mode: hard
    title: "Approve"
    depends_on: [keep]
  - id: clip
    kind: generate
    capability: image2video
    prompt: "clip from {{ vars.hero }}"
    depends_on: [gate]
`);
    const effects = recordingEffects();
    const paused = await execute(workflow, scope, effects, {});
    expect(paused.status).toBe('awaiting_approval');
    // Simulate the host rebuilding the state from persisted rows: the vars map
    // is not stored separately, only each step's status and outputs.
    const { vars: _dropped, ...rebuilt } = paused;
    expect(_dropped).toBeDefined();
    const gate = rebuilt.steps.find((node) => node.instance_id === 'gate')!;
    gate.status = 'pending';
    gate.approval_cleared = true;
    gate.step = { ...gate.step } as Step;
    const resumed = await execute(workflow, scope, { ...effects, decide: () => 'approve' }, {}, rebuilt);
    expect(resumed.status).toBe('completed');
    expect(effects.seen.get('clip')).toBe('clip from asset:board');
  });
});

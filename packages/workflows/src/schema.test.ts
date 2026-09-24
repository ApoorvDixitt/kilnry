// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { canonicaliseId, parseWorkflow, WorkflowParseError } from './parse.js';
import { WorkflowFileSchema } from './schema.js';

const MINIMAL = `
id: kilnry-demo
name: Demo
version: 1.0.0
category: image
requires: [text2image]
inputs:
  type: object
  required: [prompt]
  properties:
    prompt: { type: string, x-kilnry: { widget: text } }
budget: { max_usd: 1 }
steps:
  - id: gen
    kind: generate
    capability: text2image
    prompt: "{{ inputs.prompt }}"
    outputs: { asset: "{{ result.assets[0] }}" }
outputs:
  final: "{{ steps.gen.outputs.asset }}"
`;

describe('workflow schema and parser (F-WFL-06a)', () => {
  it('parses a minimal valid workflow and applies step defaults', () => {
    const wf = parseWorkflow(MINIMAL);
    expect(wf.id).toBe('kilnry-demo');
    expect(wf.category).toBe('image');
    expect(wf.steps).toHaveLength(1);
    const step = wf.steps[0]!;
    expect(step.kind).toBe('generate');
    // defaults from baseShape / GenerateStep applied
    if (step.kind === 'generate') {
      expect(step.model).toBe('auto');
      expect(step.on_fail).toBe('fail');
      expect(step.count).toBe(1);
    }
  });

  it('canonicalises a kilnry. id to kilnry-', () => {
    expect(canonicaliseId('kilnry.ugc-ad')).toBe('kilnry-ugc-ad');
    expect(canonicaliseId('kilnry-ugc-ad')).toBe('kilnry-ugc-ad');
    const wf = parseWorkflow(MINIMAL.replace('id: kilnry-demo', 'id: kilnry.demo'));
    expect(wf.id).toBe('kilnry-demo');
  });

  it('accepts every step kind in a nested tree', () => {
    const nested = `
id: kilnry-kinds
name: Kinds
version: 1.0.0
category: video
steps:
  - id: setup
    kind: set
    values: { n: "{{ 3 }}" }
  - id: pick
    kind: branch
    when: "{{ vars.n > 1 }}"
    then:
      - id: an
        kind: analyze
        task: describe
        instructions: "hi"
    else: []
  - id: loop
    kind: foreach
    over: "{{ range(0, vars.n) }}"
    steps:
      - id: clip
        kind: generate
        capability: reference2video
        prompt: "shot {{ index }}"
      - id: probe
        kind: assemble
        op: probe
        inputs: ["{{ steps.clip.outputs.asset }}"]
  - id: gate
    kind: approval
    title: "Approve"
  - id: fix
    kind: transform
    op: transcribe
    source: "{{ steps.loop.assets[0] }}"
  - id: out
    kind: export
    files: [{ ref: "{{ steps.loop.assets[0] }}", name: final.mp4 }]
`;
    const wf = parseWorkflow(nested);
    expect(wf.steps.map((step) => step.kind)).toEqual([
      'set',
      'branch',
      'foreach',
      'approval',
      'transform',
      'export',
    ]);
  });

  it('rejects a file that is not a mapping', () => {
    expect(() => parseWorkflow('- just\n- a\n- list')).toThrow(WorkflowParseError);
  });

  it('rejects an unknown step kind and a bad version', () => {
    const bad = WorkflowFileSchema.safeParse({
      id: 'kilnry-x',
      name: 'X',
      version: '1.0',
      category: 'image',
      steps: [{ id: 's', kind: 'teleport' }],
    });
    expect(bad.success).toBe(false);
  });
});

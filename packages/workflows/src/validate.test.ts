// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { validateWorkflowFile } from './validate.js';

const VALID = `
id: kilnry-demo
name: Demo
version: 1.0.0
category: image
requires: [text2image]
inputs:
  type: object
  properties:
    prompt: { type: string }
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

function errorRules(yaml: string, fileName = 'kilnry-demo'): string[] {
  return validateWorkflowFile(yaml, fileName)
    .issues.filter((issue) => issue.level === 'error')
    .map((issue) => issue.rule);
}

describe('workflow validator (F-WFL-06, TRD-12 §7)', () => {
  it('accepts a valid workflow whose id matches the file name', () => {
    const result = validateWorkflowFile(VALID, 'kilnry-demo');
    expect(result.ok).toBe(true);
    expect(result.issues.filter((issue) => issue.level === 'error')).toEqual([]);
  });

  it('rule 1: id must equal the file name', () => {
    expect(errorRules(VALID, 'other-name')).toContain('7.1');
  });

  it('rule 2: step ids must be unique across the tree', () => {
    const withDup = `
id: kilnry-dup
name: Dup
version: 1.0.0
category: image
steps:
  - id: gen
    kind: generate
    capability: text2image
    prompt: "x"
    outputs: { asset: "{{ result.assets[0] }}" }
  - id: gen
    kind: set
    values: { x: "1" }
`;
    expect(errorRules(withDup, 'kilnry-dup')).toContain('7.2');
  });

  it('rule 4: a foreach over step outputs must set expect', () => {
    const yaml = `
id: kilnry-fe
name: Fe
version: 1.0.0
category: video
steps:
  - id: make
    kind: generate
    capability: text2image
    prompt: "x"
    outputs: { items: "{{ result.assets }}" }
  - id: loop
    kind: foreach
    over: "{{ steps.make.outputs.items }}"
    steps:
      - id: one
        kind: generate
        capability: text2image
        prompt: "y"
`;
    expect(errorRules(yaml, 'kilnry-fe')).toContain('7.4');
  });

  it('rule 7: refuses a provider prompt token in a prompt', () => {
    const yaml = VALID.replace('"{{ inputs.prompt }}"', '"inject <<< maya >>> here"');
    expect(errorRules(yaml)).toContain('7.7');
  });

  it('rule 11: refuses a file:// or .. media ref', () => {
    const yaml = VALID.replace(
      '    prompt: "{{ inputs.prompt }}"',
      '    prompt: "x"\n    medias: [{ role: reference, ref: "file:///etc/passwd" }]',
    );
    expect(errorRules(yaml)).toContain('7.11');
  });

  it('rule 6: refuses an unknown assemble op', () => {
    const yaml = `
id: kilnry-a
name: A
version: 1.0.0
category: video
steps:
  - id: gen
    kind: generate
    capability: text2image
    prompt: "x"
    outputs: { asset: "{{ result.assets[0] }}" }
  - id: bad
    kind: assemble
    op: teleport
    inputs: ["{{ steps.gen.outputs.asset }}"]
`;
    // op teleport is not in the enum, so the schema rejects the step first — a
    // parse (rule 1) error is acceptable, or the op rule; either way it is invalid.
    const result = validateWorkflowFile(yaml, 'kilnry-a');
    expect(result.ok).toBe(false);
  });

  // F-65: TRD-12:218 says assemble.params validate against the op's schema, and
  // only the op name was checked — so a parameter the builder never reads passed
  // validation and was dropped at run time, which AGENTS.md:97 calls a defect.
  it('refuses an assemble param the op does not read, and names the ones it takes', () => {
    const yaml = `
id: kilnry-a
name: A
version: 1.0.0
category: image
steps:
  - id: gen
    kind: generate
    capability: text2image
    prompt: "x"
    outputs: { asset: "{{ result.assets[0] }}" }
  - id: join
    kind: assemble
    op: concat
    inputs: ["{{ steps.gen.outputs.asset }}"]
    params: { mode: auto, crossfade_s: 2 }
`;
    const result = validateWorkflowFile(yaml, 'kilnry-a');
    expect(result.ok).toBe(false);
    const messages = result.issues.map((issue) => issue.message).join(' ');
    expect(messages).toContain('passes "crossfade_s" to concat');
    expect(messages).toContain('concat takes: mode, target');
  });

  it('accepts every parameter the op does read', () => {
    const yaml = `
id: kilnry-a
name: A
version: 1.0.0
category: image
steps:
  - id: gen
    kind: generate
    capability: text2image
    prompt: "x"
    outputs: { asset: "{{ result.assets[0] }}" }
  - id: frames
    kind: assemble
    op: extract_frames
    inputs: ["{{ steps.gen.outputs.asset }}"]
    params: { mode: scene, scene_threshold: 0.4, max_width: 1920 }
`;
    expect(validateWorkflowFile(yaml, 'kilnry-a').ok).toBe(true);
  });
});

// UX-09 / UX-18: the run view and the approval card showed bare step ids
// (`export`, `pick`, `text`) and the catalogue card the agent-facing
// description, because nothing required a shipped workflow to name its steps or
// carry a one-line summary.
describe('rule 7.12: a shipped catalogue workflow names every step and has a summary', () => {
  const shipped = '/repo/packages/workflows/catalogue/kilnry-test.yaml';
  const base = (extra = '', stepName = ''): string => `id: kilnry-test
name: Test
version: 1.0.0
category: utility
${extra}steps:
  - id: one
${stepName}    kind: set
    values: { a: "{{ 1 }}" }
`;
  const rule12 = (yaml: string, path?: string): string[] =>
    validateWorkflowFile(yaml, 'kilnry-test', path)
      .issues.filter((issue) => issue.rule === '7.12')
      .map((issue) => issue.message);

  it('refuses a shipped workflow with an unnamed step or no summary', () => {
    expect(validateWorkflowFile(base(), 'kilnry-test', shipped).ok).toBe(false);
    expect(rule12(base(), shipped)).toEqual([
      'a catalogue workflow needs a one-line summary for its card.',
      'step "one" needs a name: the run view and the approval card show it.',
    ]);
  });

  it('accepts it named and summarised, and leaves a user or imported file optional', () => {
    expect(rule12(base('summary: One line.\n', '    name: One\n'), shipped)).toEqual([]);
    expect(rule12(base(), '/home/me/.kilnry/workflows/kilnry-test.yaml')).toEqual([]);
    expect(rule12(base())).toEqual([]);
  });
});

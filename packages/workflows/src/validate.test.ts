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
});

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { parseWorkflow } from './parse.js';
import { buildSavedWorkflow, slugify } from './save-run.js';

const SOURCE = `
id: kilnry-demo
name: Demo
version: 1.2.0
category: image
requires: [image_edit]
inputs:
  type: object
  required: [subject]
  properties:
    subject: { type: string }
    variants: { type: integer, default: 2 }
steps:
  - id: shot
    kind: generate
    capability: image_edit
    model: auto
    alternates: [fal-ai/nano-banana-pro/edit]
    prompt: "a photo of {{ inputs.subject }}"
  - id: approve
    kind: approval
    mode: hard
    title: Approve
`;

describe('save a run as a workflow (F-WFL-10)', () => {
  it('slugifies a name into a filesystem-safe handle', () => {
    expect(slugify('My Great Ad!! ')).toBe('my-great-ad');
    expect(slugify('   ')).toBe('workflow');
  });

  it('round-trips: a saved run parses back as a valid workflow with pinned inputs and model', () => {
    const source = parseWorkflow(SOURCE);
    const saved = buildSavedWorkflow({
      source,
      name: 'My Saved Run',
      author: 'kiro',
      inputs: { subject: 'a red mug', variants: 4 },
      models: { shot: 'fal-ai/nano-banana-pro/edit' },
    });

    expect(saved.id).toBe('kiro.my-saved-run');
    expect(saved.filename).toBe('kiro.my-saved-run.yaml');
    expect(saved.yaml.startsWith('# Kilnry —')).toBe(true);

    // The YAML parses back to a valid workflow — the round-trip contract.
    const reparsed = parseWorkflow(saved.yaml);
    expect(reparsed.id).toBe('kiro.my-saved-run');
    expect(reparsed.name).toBe('My Saved Run');

    // The run's inputs are pinned as defaults; the source schema (type) survives.
    const props = (reparsed.inputs as { properties: Record<string, { default?: unknown; type?: string }> })
      .properties;
    expect(props.subject?.default).toBe('a red mug');
    expect(props.subject?.type).toBe('string');
    expect(props.variants?.default).toBe(4);

    // The generate step's model is pinned to the run's; approvals are kept.
    const shot = reparsed.steps.find((step) => step.id === 'shot');
    expect(shot?.kind).toBe('generate');
    if (shot?.kind === 'generate') {
      expect(shot.model).toBe('fal-ai/nano-banana-pro/edit');
      expect(shot.alternates).toContain('fal-ai/nano-banana-pro/edit');
    }
    expect(reparsed.steps.some((step) => step.kind === 'approval')).toBe(true);
  });

  it('leaves an auto model as auto', () => {
    const source = parseWorkflow(SOURCE);
    const saved = buildSavedWorkflow({
      source,
      name: 'Auto Run',
      inputs: { subject: 'x' },
      models: { shot: 'auto' },
    });
    const shot = parseWorkflow(saved.yaml).steps.find((step) => step.id === 'shot');
    if (shot?.kind === 'generate') expect(shot.model).toBe('auto');
  });

  it('fixes an input turned off as a const read-only field and drops it from required', () => {
    const source = parseWorkflow(SOURCE);
    const saved = buildSavedWorkflow({
      source,
      name: 'Fixed Subject',
      author: 'kiro',
      inputs: { subject: 'a red mug', variants: 4 },
      // subject off (fixed), variants on (editable field).
      fields: { subject: false, variants: true },
    });
    const reparsed = parseWorkflow(saved.yaml);
    const props = reparsed.inputs as {
      required?: string[];
      properties: Record<string, { const?: unknown; default?: unknown; 'x-kilnry'?: { widget?: string } }>;
    };
    // subject is a const chip and no longer required; variants stays a field.
    expect(props.properties.subject?.const).toBe('a red mug');
    expect(props.properties.subject?.['x-kilnry']?.widget).toBe('const');
    expect(props.required ?? []).not.toContain('subject');
    expect(props.properties.variants?.const).toBeUndefined();
    expect(props.properties.variants?.default).toBe(4);
  });
});

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import {
  initialInputs,
  missingRequired,
  readInputFields,
  stepCostLabel,
  totalLabel,
  type PlanView,
} from './workflow-intake-drawer-logic';

const INPUTS = {
  type: 'object',
  required: ['duration_s', 'mode'],
  properties: {
    duration_s: { type: 'integer', default: 15, 'x-kilnry': { widget: 'chips', unit: 's' } },
    mode: {
      type: 'string',
      enum: ['review', 'product-only'],
      default: 'review',
      'x-kilnry': { widget: 'segment', labels: { review: 'Review', 'product-only': 'Product only' } },
    },
    product: { type: 'string', 'x-kilnry': { widget: 'media' } },
    captions: { type: 'boolean', default: true, 'x-kilnry': { widget: 'toggle' } },
  },
};

describe('workflow intake drawer logic (F-WFL-02)', () => {
  it('reads fields with their widgets and required flags', () => {
    const fields = readInputFields(INPUTS);
    expect(fields).toHaveLength(4);
    const duration = fields.find((field) => field.name === 'duration_s')!;
    expect(duration.widget).toBe('chips');
    expect(duration.required).toBe(true);
    const mode = fields.find((field) => field.name === 'mode')!;
    expect(mode.widget).toBe('segment');
    expect(mode.enum).toEqual(['review', 'product-only']);
    const captions = fields.find((field) => field.name === 'captions')!;
    expect(captions.widget).toBe('toggle');
  });

  it('applies defaults and reports missing required fields', () => {
    const fields = readInputFields(INPUTS);
    const values = initialInputs(fields);
    expect(values.duration_s).toBe(15);
    expect(values.mode).toBe('review');
    expect(values.captions).toBe(true);
    // product is not required, so nothing is missing with the defaults applied.
    expect(missingRequired(fields, values)).toEqual([]);
    // clearing a required field reports it.
    expect(missingRequired(fields, { ...values, mode: '' })).toEqual(['mode']);
  });

  it('formats per-step and total costs', () => {
    const plan: PlanView = {
      workflow_id: 'kilnry-ugc-ad',
      total_estimate_usd: 3.85,
      eta_s: 60,
      steps: [
        { step_id: 'board', name: 'Storyboard', kind: 'generate', estimate_usd: 0.22, eta_s: 10 },
        { step_id: 'assemble', name: 'Assemble', kind: 'assemble', estimate_usd: 0, eta_s: 0 },
      ],
      warnings: [],
    };
    expect(stepCostLabel(plan.steps[0]!)).toBe('$0.22');
    expect(stepCostLabel(plan.steps[1]!)).toBe('no spend');
    expect(totalLabel(plan)).toBe('$3.85');
  });
});

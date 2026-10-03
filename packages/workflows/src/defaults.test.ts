// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { parseWorkflow } from './parse.js';
import { applyInputDefaults } from './defaults.js';

const WF = `
id: kilnry-defaults-demo
name: Defaults demo
version: 1.0.0
category: video
inputs:
  type: object
  required: [brief]
  properties:
    brief: { type: string }
    duration_s: { type: integer, default: 30 }
    aspect: { type: string, default: '16:9' }
    tags: { type: array, default: [] }
steps:
  - id: plan
    kind: set
    values: { total: '{{ inputs.duration_s * 2 }}' }
`;

describe('input defaults (F-WFL-06)', () => {
  it('fills missing optional inputs with their schema default, keeping what was given', () => {
    const workflow = parseWorkflow(WF);
    const resolved = applyInputDefaults(workflow, { brief: 'A valley', aspect: '9:16' });
    expect(resolved).toEqual({ brief: 'A valley', aspect: '9:16', duration_s: 30, tags: [] });
  });

  it('does not invent a value for a required input that was omitted', () => {
    const workflow = parseWorkflow(WF);
    expect(applyInputDefaults(workflow, {})).toEqual({ duration_s: 30, aspect: '16:9', tags: [] });
  });
});

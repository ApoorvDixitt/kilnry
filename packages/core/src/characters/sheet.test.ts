// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { ALL_VIEWS, EXPRESSIONS, approvalIndex, planSheet, viewFileName } from './sheet.js';

describe('reference-sheet pipeline (F-CHR-04)', () => {
  it('names each turnaround view file per PRD-07 §5.6', () => {
    expect(viewFileName('front')).toBe('turnaround_front.png');
    expect(viewFileName('full_body')).toBe('turnaround_full_body.png');
    expect(ALL_VIEWS).toHaveLength(7);
  });

  it('generates the two turnaround sheets, cuts them, then pauses for approval before spending more', () => {
    const steps = planSheet({ short: 'A calm woman. Freckles, green eyes.' });
    const ids = steps.map((step) => step.id);
    // Sheets and their split come before the approval checkpoint.
    expect(ids.indexOf('sheet_a')).toBeLessThan(ids.indexOf('approve_turnaround'));
    expect(ids.indexOf('split_a')).toBeLessThan(ids.indexOf('approve_turnaround'));
    expect(ids.indexOf('register_turnaround')).toBeLessThan(ids.indexOf('approve_turnaround'));
    // Expressions come after the approval checkpoint.
    expect(ids.indexOf('expressions')).toBeGreaterThan(ids.indexOf('approve_turnaround'));
    expect(approvalIndex(steps)).toBeGreaterThan(0);
  });

  it('cuts sheet A into four views and sheet B into two', () => {
    const steps = planSheet({ short: 'x' });
    const splitA = steps.find((step) => step.id === 'split_a');
    const splitB = steps.find((step) => step.id === 'split_b');
    expect(splitA?.panels).toEqual(['front', 'three_quarter_left', 'profile_left', 'back']);
    expect(splitB?.panels).toEqual(['three_quarter_right', 'profile_right']);
  });

  it('omits the expression grid when expressions are off', () => {
    const steps = planSheet({ short: 'x', expressions: false });
    expect(steps.some((step) => step.id === 'expressions')).toBe(false);
  });

  it('adds a generate step per requested outfit and state', () => {
    const steps = planSheet({
      short: 'x',
      outfits: [{ label: 'raincoat' }],
      states: [{ label: 'wet' }],
    });
    expect(steps.some((step) => step.id === 'outfit_raincoat' && step.role === 'outfit')).toBe(true);
    expect(steps.some((step) => step.id === 'state_wet' && step.role === 'state')).toBe(true);
  });

  it('embeds the short summary in each sheet prompt', () => {
    const steps = planSheet({ short: 'A calm woman. Freckles.' });
    const sheetA = steps.find((step) => step.id === 'sheet_a');
    expect(sheetA?.prompt).toContain('A calm woman. Freckles.');
    expect(EXPRESSIONS).toHaveLength(9);
  });
});

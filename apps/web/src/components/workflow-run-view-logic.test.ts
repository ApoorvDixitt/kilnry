// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { costSoFarLabel, isLive, progress, statusGlyph, type RunView } from './workflow-run-view-logic';

function run(overrides: Partial<RunView> = {}): RunView {
  return {
    id: 'run_1',
    workflow_id: 'kilnry-ugc-ad',
    status: 'running',
    folder: 'Client_A/UGC_ad_2026-09-18_1120',
    estimate_usd: 2.4,
    spent_usd: 1.86,
    steps: [
      {
        step_id: 'plan',
        name: 'Plan',
        kind: 'set',
        status: 'completed',
        model: null,
        estimate_usd: 0,
        actual_usd: 0,
      },
      {
        step_id: 'board',
        name: 'Storyboard',
        kind: 'generate',
        status: 'running',
        model: 'gpt-image-2.5',
        estimate_usd: 0.22,
        actual_usd: null,
      },
      {
        step_id: 'clip',
        name: 'Clip',
        kind: 'generate',
        status: 'queued',
        model: 'seedance',
        estimate_usd: 1.5,
        actual_usd: null,
      },
    ],
    ...overrides,
  };
}

describe('workflow run view logic (F-WFL-03)', () => {
  it('maps each status to its glyph', () => {
    expect(statusGlyph('completed')).toBe('check');
    expect(statusGlyph('running')).toBe('spinner');
    expect(statusGlyph('failed')).toBe('failed');
    expect(statusGlyph('skipped')).toBe('skipped');
    expect(statusGlyph('waiting')).toBe('waiting');
    expect(statusGlyph('queued')).toBe('queued');
  });

  it('counts done of total for the progress bar', () => {
    const p = progress(run());
    expect(p.done).toBe(1);
    expect(p.total).toBe(3);
    expect(p.fraction).toBeCloseTo(1 / 3, 6);
  });

  it('formats the cost-so-far line', () => {
    expect(costSoFarLabel(run())).toBe('$1.86 so far of ≈ $2.40');
  });

  it('polls only while the run is live', () => {
    expect(isLive('running')).toBe(true);
    expect(isLive('awaiting_approval')).toBe(true);
    expect(isLive('completed')).toBe(false);
    expect(isLive('cancelled')).toBe(false);
  });
});

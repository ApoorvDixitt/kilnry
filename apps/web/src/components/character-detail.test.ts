// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { partitionReferences, sheetView, wordCount } from './character-detail-logic';

const ref = (role: string, extra: Record<string, string> = {}) => ({
  id: crypto.randomUUID(),
  asset_id: crypto.randomUUID(),
  preview_url: '/api/thumb/x',
  role,
  ...extra,
});

describe('partitionReferences', () => {
  it('splits references into anchor/turnaround, expressions and outfits/states', () => {
    const refs = [
      ref('anchor', { view: 'front' }),
      ref('turnaround', { view: 'profile_left' }),
      ref('expression', { label: 'smile' }),
      ref('outfit', { label: 'wet' }),
      ref('state', { label: 'rain' }),
    ];
    const parts = partitionReferences(refs);
    expect(parts.anchorAndTurnaround).toHaveLength(2);
    expect(parts.expressions).toHaveLength(1);
    expect(parts.outfits).toHaveLength(2);
  });
});

describe('wordCount', () => {
  it('counts words and treats blank as zero', () => {
    expect(wordCount('a woman with a bob')).toBe(5);
    expect(wordCount('   ')).toBe(0);
  });
});

describe('sheetView (F-CHR-04)', () => {
  const empty = { steps: [], runId: null, status: null };

  it('records the plan, run id and status from a build response', () => {
    const next = sheetView(empty, {
      run_id: 'run_1',
      status: 'awaiting_approval',
      plan: {
        steps: [
          { id: 'sheet_a', name: 'Turnaround sheet A', kind: 'generate' },
          { id: 'approve_turnaround', name: 'Approve the turnaround', kind: 'approval' },
        ],
      },
    });
    expect(next.runId).toBe('run_1');
    expect(next.status).toBe('awaiting_approval');
    expect(next.steps).toHaveLength(2);
  });

  it('prefers the run steps over the plan and keeps the run id', () => {
    const seeded = { steps: [], runId: 'run_1', status: 'awaiting_approval' };
    const next = sheetView(seeded, {
      run: {
        status: 'completed',
        steps: [{ id: 'expressions', name: 'Expression grid', kind: 'generate', status: 'completed' }],
      },
      status: 'completed',
    });
    expect(next.status).toBe('completed');
    expect(next.runId).toBe('run_1');
    expect(next.steps[0]?.status).toBe('completed');
  });

  it('clears the steps on a failed response', () => {
    expect(
      sheetView({ steps: [{ id: 'x', name: 'x', kind: 'generate' }], runId: 'r', status: 'running' }, null)
        .steps,
    ).toEqual([]);
  });
});

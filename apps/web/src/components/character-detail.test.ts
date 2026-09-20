// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { partitionReferences, wordCount } from './character-detail-logic';

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

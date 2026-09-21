// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { approvedFrom, canFetch, handleFromTitle, toggleClaim } from './product-url-logic';

describe('product-url logic (F-ELM-04)', () => {
  it('only fetches https addresses', () => {
    expect(canFetch('https://example.in/p')).toBe(true);
    expect(canFetch('http://example.in/p')).toBe(false);
    expect(canFetch('ftp://x')).toBe(false);
    expect(canFetch('  ')).toBe(false);
  });

  it('toggles a claim in and out of the ticked set', () => {
    let ticked = new Set<string>();
    ticked = toggleClaim(ticked, 'Brightens in 14 days');
    expect(ticked.has('Brightens in 14 days')).toBe(true);
    ticked = toggleClaim(ticked, 'Brightens in 14 days');
    expect(ticked.has('Brightens in 14 days')).toBe(false);
  });

  it('collects only ticked claims, in order', () => {
    const claims = ['A helps', 'B reduces', 'C certified'];
    expect(approvedFrom(claims, new Set(['C certified', 'A helps']))).toEqual(['A helps', 'C certified']);
  });

  it('suggests a handle from the title', () => {
    expect(handleFromTitle('Hero Vitamin C Serum 30 ml')).toBe('hero_vitamin_c_serum_30_ml');
  });
});

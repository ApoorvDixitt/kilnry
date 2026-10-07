// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import {
  cacheWorthClearing,
  gb,
  pauseBannerText,
  shouldShowBanner,
  warnBannerText,
} from './disk-banner-logic';
import { priceAgeLine } from './provider-settings-logic';

const GB = 1024 * 1024 * 1024;

describe('disk banner logic (F-LIB-13)', () => {
  it('formats bytes as rounded whole gigabytes', () => {
    expect(gb(18 * GB)).toBe('18 GB');
    expect(gb(0.8 * GB)).toBe('1 GB');
  });

  // UX-06: the banner led with a percentage computed from the bytes the
  // filesystem reports as available, which on APFS excludes purgeable space — a
  // machine 69 % full by `df` was told it was 98 % full — and it offered a Clear
  // cache button for a cache of 0.0 GB. The free figure and the pause threshold
  // are the facts the user can act on.
  it('states the free space and the pause threshold, and mentions the cache only when there is one', () => {
    expect(
      warnBannerText({
        total_bytes: 500 * GB,
        free_bytes: 5.3 * GB,
        used_fraction: 0.98,
        cache_bytes: 0,
        level: 'warn',
      }),
    ).toBe('5.3 GB free on this disk; Kilnry pauses imports under 1 GB.');
    expect(
      warnBannerText({
        total_bytes: 500 * GB,
        free_bytes: 18 * GB,
        used_fraction: 0.92,
        cache_bytes: 2.1 * GB,
        level: 'warn',
      }),
    ).toBe("18.0 GB free on this disk; Kilnry pauses imports under 1 GB. Kilnry's cache holds 2.1 GB.");
    expect(
      cacheWorthClearing({
        total_bytes: 1,
        free_bytes: 1,
        used_fraction: 0.5,
        cache_bytes: 0,
        level: 'warn',
      }),
    ).toBe(false);
  });

  it('shows the banner at warn and pause and hides at ok', () => {
    expect(
      shouldShowBanner({ total_bytes: 1, free_bytes: 1, used_fraction: 0.5, cache_bytes: 0, level: 'ok' }),
    ).toBe(false);
    expect(
      shouldShowBanner({ total_bytes: 1, free_bytes: 1, used_fraction: 0.95, cache_bytes: 0, level: 'warn' }),
    ).toBe(true);
    expect(
      shouldShowBanner({
        total_bytes: 1,
        free_bytes: 1,
        used_fraction: 0.99,
        cache_bytes: 0,
        level: 'pause',
      }),
    ).toBe(true);
  });

  it('renders the pause copy when under 1 GB', () => {
    expect(pauseBannerText()).toContain('at least 1 GB');
  });
});

// UX-10: the provider card showed "Prices N days old" from the first day, a
// number with no threshold, which reads as a warning. It belongs in the last ten
// days before the stored limit, with the limit named.
describe('the provider price-age line (UX-10)', () => {
  const day = 86_400_000;
  it('says the prices are current until the limit is near, then names the limit', () => {
    const at = (days: number): string => new Date(Date.now() - days * day).toISOString();
    expect(priceAgeLine(at(2), 30)).toBe('Prices current');
    expect(priceAgeLine(at(19), 30)).toBe('Prices current');
    expect(priceAgeLine(at(21), 30)).toBe('Prices 21 days old · refresh before 30');
    // A workspace with a tighter threshold warns sooner.
    expect(priceAgeLine(at(2), 3)).toBe('Prices 2 days old · refresh before 3');
    expect(priceAgeLine(null, 30)).toBe('Price age unavailable');
  });
});

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { gb, pauseBannerText, shouldShowBanner, warnBannerText } from './disk-banner-logic';

const GB = 1024 * 1024 * 1024;

describe('disk banner logic (F-LIB-13)', () => {
  it('formats bytes as rounded whole gigabytes', () => {
    expect(gb(18 * GB)).toBe('18 GB');
    expect(gb(0.8 * GB)).toBe('1 GB');
  });

  it('produces the exact PRD-06 §14 warn banner text with the volume numbers', () => {
    expect(
      warnBannerText({
        total_bytes: 500 * GB,
        free_bytes: 18 * GB,
        used_fraction: 0.92,
        cache_bytes: 2.1 * GB,
        level: 'warn',
      }),
    ).toBe("Your disk is 92 % full (18 GB free). Free space or clear Kilnry's cache (2.1 GB).");
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

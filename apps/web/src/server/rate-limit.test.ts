// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { afterEach, describe, expect, it } from 'vitest';
import { resetRateLimits, takeRateLimit } from './rate-limit';

afterEach(resetRateLimits);

describe('API rate limits', () => {
  it('blocks at the configured limit and resets after the window', () => {
    expect(takeRateLimit('session:generate', 2, 1000, 100)).toMatchObject({ allowed: true, remaining: 1 });
    expect(takeRateLimit('session:generate', 2, 1000, 101)).toMatchObject({ allowed: true, remaining: 0 });
    expect(takeRateLimit('session:generate', 2, 1000, 102)).toMatchObject({
      allowed: false,
      retry_after_s: 1,
    });
    expect(takeRateLimit('session:generate', 2, 1000, 1100)).toMatchObject({
      allowed: true,
      remaining: 1,
    });
  });
});

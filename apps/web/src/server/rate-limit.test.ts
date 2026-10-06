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

  // F-31: TRD-15 §7 limits the MCP endpoint to 120 requests a minute per token
  // with a 429 and Retry-After. /mcp is not under /api/, which is all the proxy's
  // rate-limit block covered, so the endpoint had no request throttle at all.
  it('gives each MCP token its own 120-a-minute bucket', () => {
    for (let call = 1; call <= 120; call += 1) {
      expect(takeRateLimit('mcp:token-a', 120, 60_000, 1_000), String(call)).toMatchObject({
        allowed: true,
      });
    }
    const refused = takeRateLimit('mcp:token-a', 120, 60_000, 1_000);
    expect(refused.allowed).toBe(false);
    expect(refused.retry_after_s).toBeGreaterThan(0);
    // A second token is unaffected, and the first is free again after the window.
    expect(takeRateLimit('mcp:token-b', 120, 60_000, 1_000)).toMatchObject({ allowed: true });
    expect(takeRateLimit('mcp:token-a', 120, 60_000, 62_000)).toMatchObject({ allowed: true });
  });
});

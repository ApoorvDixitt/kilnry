// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

interface Bucket {
  count: number;
  reset_at: number;
}

const buckets = new Map<string, Bucket>();

export function takeRateLimit(
  key: string,
  limit: number,
  windowMs = 60_000,
  now = Date.now(),
): { allowed: boolean; remaining: number; retry_after_s: number } {
  const current = buckets.get(key);
  const bucket = !current || current.reset_at <= now ? { count: 0, reset_at: now + windowMs } : current;
  if (bucket.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retry_after_s: Math.max(1, Math.ceil((bucket.reset_at - now) / 1000)),
    };
  }
  bucket.count += 1;
  buckets.set(key, bucket);
  return {
    allowed: true,
    remaining: Math.max(0, limit - bucket.count),
    retry_after_s: Math.max(1, Math.ceil((bucket.reset_at - now) / 1000)),
  };
}

export function resetRateLimits(): void {
  buckets.clear();
}

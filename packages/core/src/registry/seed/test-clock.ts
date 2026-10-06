// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { SEEDED_AT } from './helpers.js';

// The clock tests use when they price against the bundled seed (D-71a). Every
// seeded snapshot is stamped SEEDED_AT, and estimate() judges a price's age
// against the caller's clock; a test that read the wall clock would see the
// whole seed go stale 30 days after SEEDED_AT and fail for no reason of its own.
// This is the one place that pins it: SEEDED_AT plus one day, advancing in real
// time from there so timestamps still order and durations are still positive.
// Production never calls this; it passes the real clock.
export const SEED_CLOCK_OFFSET_MS = 86_400_000;

export function seedPinnedClock(offsetMs: number = SEED_CLOCK_OFFSET_MS): () => Date {
  const start = Date.parse(SEEDED_AT) + offsetMs;
  const origin = Date.now();
  return () => new Date(start + (Date.now() - origin));
}

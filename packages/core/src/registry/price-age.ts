// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The age past which a price snapshot is stale (PRD-14 §8: 30, default;
// adjustable — a stored workspace setting, read by the engine on every estimate
// and edited in Settings › Providers beside "Prices last refreshed", 1–3650
// days; D-73a). It was a hard-coded 30 in two places, so the setting the PRD
// names could not be changed by anyone, and every acceptance shard priced from
// the bundled seed against the real clock — turning CI red 30 days after
// `seeded_at` with no code change.

import { eq } from 'drizzle-orm';
import { settings } from '@kilnry/db';
import type { DatabaseState } from '@kilnry/db';

export const PRICE_MAX_AGE_DAYS_DEFAULT = 30;
export const PRICE_MAX_AGE_DAYS_MIN = 1;
export const PRICE_MAX_AGE_DAYS_MAX = 3650;
export const PRICE_MAX_AGE_SETTING = 'providers.price_max_age_days';

/** A stored value outside the PRD's range is clamped, never obeyed. */
export function clampPriceMaxAgeDays(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return PRICE_MAX_AGE_DAYS_DEFAULT;
  return Math.min(PRICE_MAX_AGE_DAYS_MAX, Math.max(PRICE_MAX_AGE_DAYS_MIN, Math.round(numeric)));
}

/**
 * The stored threshold, or the default when nothing is stored. Every paid path
 * reads this before pricing so the figure the user sees and the refusal they
 * get agree with the setting (TRD-07 §6 rule 3).
 */
export async function priceMaxAgeDays(state: DatabaseState): Promise<number> {
  await state.ready;
  const rows = await state.db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, PRICE_MAX_AGE_SETTING))
    .limit(1);
  const stored = rows[0]?.value;
  if (stored === undefined || stored === null) return PRICE_MAX_AGE_DAYS_DEFAULT;
  return clampPriceMaxAgeDays(stored);
}

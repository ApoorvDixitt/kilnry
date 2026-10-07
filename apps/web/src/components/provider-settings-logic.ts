// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The decisions Settings › Providers makes about what to show, kept out of the
// view so they can be tested without a browser.

import { message } from '../lib/messages';

/**
 * The price-age line (UX-10). Every card showed "Prices N days old" from the
 * first day, which reads as a warning without saying what the limit is. The age
 * is shown in the last ten days before the stored threshold, with the threshold
 * named, and otherwise the line says the prices are current.
 */
export function priceAgeLine(fetchedAt: string | null | undefined, limitDays: number): string {
  if (!fetchedAt) return message('settings.providers.priceUnknown');
  const days = Math.max(0, Math.floor((Date.now() - new Date(fetchedAt).getTime()) / 86_400_000));
  if (days < Math.max(1, limitDays - 10)) return message('settings.providers.priceCurrent');
  return message('settings.providers.priceAgeWarn')
    .replace('{days}', String(days))
    .replace('{limit}', String(limitDays));
}

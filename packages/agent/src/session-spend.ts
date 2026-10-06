// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// What a tool call added to a Chat session's spend (F-104). The session budget
// of Run automatically (PRD-14:173) counts every spend the agent proceeds with,
// not only its own language-model tokens: the settled actual when the tool
// reports one, otherwise the confirmed estimate of the work it started. A call
// that only asked for confirmation, failed or spent nothing adds nothing.

import { SPEND_TOOLS } from './approval.js';

function amount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function toolSpendUsd(name: string, structured: Record<string, unknown> | undefined): number {
  if (!SPEND_TOOLS.has(name) || !structured) return 0;
  if (structured['error'] !== undefined || structured['needs_confirmation'] === true) return 0;
  const actual = amount(structured['actual_usd']);
  if (actual !== undefined) return actual;
  const total = amount(structured['total_estimate_usd']);
  if (total !== undefined) return total;
  const jobs = structured['jobs'];
  if (Array.isArray(jobs)) {
    const sum = jobs.reduce<number>((acc, job) => {
      const value =
        job && typeof job === 'object' ? amount((job as Record<string, unknown>)['estimate_usd']) : undefined;
      return acc + (value ?? 0);
    }, 0);
    if (sum > 0) return sum;
  }
  return amount(structured['estimate_usd']) ?? 0;
}

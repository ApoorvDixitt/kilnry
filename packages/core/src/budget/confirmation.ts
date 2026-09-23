// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The money-round-trip decision for spending tools (TRD-10 §2.5, F-MCP-06). A
// spending tool computes the estimate, then asks whether it may charge without a
// round trip. It may proceed only when the caller acknowledged a cost within ten
// percent of the estimate, or when the whole estimate is at or below the
// auto-approve threshold. Otherwise it returns needs_confirmation and does not
// charge. A budget cap that would be exceeded is a separate, harder failure that
// the engine raises as BUDGET_EXCEEDED when the job is created.

import { KilnryError } from '../errors.js';

export interface ConfirmationInput {
  // The total estimated cost in US dollars for the whole request set.
  estimateUsd: number;
  // The cost the caller acknowledged, if any.
  confirmCostUsd?: number | undefined;
  // Generations at or below this cost run without a confirmation round trip.
  // Absent or zero means every non-zero spend needs confirmation (Ask-first).
  autoApproveBelowUsd?: number | undefined;
}

export interface ConfirmationDecision {
  // Whether the tool may charge now.
  proceed: boolean;
  // Why it may proceed, for the log and the human summary.
  reason: 'free' | 'confirmed' | 'auto_approved' | 'needs_confirmation';
}

// Decide whether a spending tool may charge now. Free requests always proceed.
export function confirmationDecision(input: ConfirmationInput): ConfirmationDecision {
  const estimate = input.estimateUsd;
  if (estimate <= 0) return { proceed: true, reason: 'free' };

  const confirmed = input.confirmCostUsd !== undefined && input.confirmCostUsd >= estimate * 0.9;
  if (confirmed) return { proceed: true, reason: 'confirmed' };

  const threshold = input.autoApproveBelowUsd ?? 0;
  if (threshold > 0 && estimate <= threshold) return { proceed: true, reason: 'auto_approved' };

  return { proceed: false, reason: 'needs_confirmation' };
}

// The only values a job's confirmed_by may hold (TRD-04): the user who confirmed
// the cost, the automatic policy, or the Model Context Protocol token that
// authorised it. The write boundary calls this so no other value ever reaches
// the jobs table.
export function normalizeConfirmedBy(value: string): string {
  if (value === 'user' || value === 'auto') return value;
  if (/^mcp:[A-Za-z0-9_-]+$/.test(value)) return value;
  throw new KilnryError(
    'INVALID_INPUT',
    `confirmed_by must be "user", "auto" or "mcp:<token_id>", not ${JSON.stringify(value)}.`,
  );
}

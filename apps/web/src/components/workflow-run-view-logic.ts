// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Pure helpers for the workflow run view (F-WFL-03). Kept out of the component so
// the status glyphs, progress and the cost-so-far line are unit-testable.

export interface RunStepView {
  step_id: string;
  name: string;
  kind: string;
  status: string;
  model: string | null;
  estimate_usd: number | null;
  actual_usd: number | null;
}

export interface RunView {
  id: string;
  workflow_id: string;
  status: string;
  folder: string | null;
  estimate_usd: number;
  spent_usd: number;
  steps: RunStepView[];
}

/** The glyph class for a step status (wireframes §9 six statuses). */
export function statusGlyph(status: string): string {
  switch (status) {
    case 'completed':
      return 'check';
    case 'running':
      return 'spinner';
    case 'failed':
    case 'denied':
      return 'failed';
    case 'skipped':
    case 'cancelled':
      return 'skipped';
    case 'waiting':
      return 'waiting';
    default:
      return 'queued';
  }
}

/** How many steps are done, of the total (n of m). */
export function progress(run: RunView): { done: number; total: number; fraction: number } {
  const total = run.steps.length;
  const done = run.steps.filter((step) => step.status === 'completed' || step.status === 'skipped').length;
  return { done, total, fraction: total === 0 ? 0 : done / total };
}

/** The header cost line: "$x.xx so far of ≈ $y.yy". */
export function costSoFarLabel(run: RunView): string {
  return `$${run.spent_usd.toFixed(2)} so far of ≈ $${run.estimate_usd.toFixed(2)}`;
}

/** Whether the run is still live and should be polled. */
export function isLive(status: string): boolean {
  return status === 'running' || status === 'awaiting_approval';
}

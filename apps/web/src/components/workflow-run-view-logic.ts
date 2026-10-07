// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Pure helpers for the workflow run view (F-WFL-03). Kept out of the component so
// the status glyphs, progress and the cost-so-far line are unit-testable. The
// user-visible strings come from the message catalogue (F-WFL-03): a status the
// map does not name falls back to the run-view status keys rather than leaking
// the database enum.

import { message } from '../lib/messages';

export interface RunStepView {
  step_id: string;
  name: string;
  kind: string;
  status: string;
  model: string | null;
  estimate_usd: number | null;
  actual_usd: number | null;
  inputs?: Record<string, unknown> | null;
  outputs?: { assets: string[] } | null;
  logs?: string | null;
  unit_price?: Record<string, unknown> | null;
  // A model swap waiting for approval because it raises the step's price
  // more than 10 % over the plan (D-61).
  pending_swap?: {
    from?: string;
    to: string;
    planned_usd: number;
    estimate_usd: number;
    run_total_usd: number;
  } | null;
}

export interface RunView {
  id: string;
  workflow_id: string;
  /** The workflow's display name, when it is still installed (UX-17). */
  workflow_name?: string | null;
  status: string;
  folder: string | null;
  estimate_usd: number;
  spent_usd: number;
  inputs?: Record<string, unknown> | null;
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
  // A decided checkpoint is finished whichever way it was decided, so a denied
  // run reads "m of m" once its remaining steps are skipped (F-64).
  const done = run.steps.filter((step) => ['completed', 'skipped', 'denied'].includes(step.status)).length;
  return { done, total, fraction: total === 0 ? 0 : done / total };
}

/** The header cost line: "$x.xx so far of ≈ $y.yy". */
export function costSoFarLabel(run: RunView): string {
  return message('workflows.runView.costSoFar')
    .replace('{spent}', run.spent_usd.toFixed(2))
    .replace('{estimate}', run.estimate_usd.toFixed(2));
}

/** Whether the run is still live and should be polled. */
export function isLive(status: string): boolean {
  return status === 'running' || status === 'awaiting_approval';
}

/** A friendly, human status for the header pill, from the message catalogue. */
export function statusLabel(status: string): string {
  try {
    return message(`workflows.runView.status.${status}`);
  } catch {
    // An unmapped status shows its raw value rather than throwing; every status
    // the run emits today has a key, so this is only a safety net.
    return status;
  }
}

/**
 * The name the Save as Workflow dialog starts with. The saved card is titled
 * from this field, and it used to start as the id ("kilnry-thumbnail (saved)"),
 * so the new card in the catalogue read like a slug (UX-17). It starts from the
 * workflow's display name; the user can edit it.
 */
export function saveDialogName(run: Pick<RunView, 'workflow_id' | 'workflow_name'>): string {
  if (run.workflow_name) return `${run.workflow_name} (saved)`;
  return run.workflow_id ? `${run.workflow_id} (saved)` : 'Saved run';
}

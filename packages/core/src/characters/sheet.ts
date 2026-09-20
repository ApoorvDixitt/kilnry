// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The reference-sheet pipeline (F-CHR-04) on the minimal linear executor from
// TRD-12 §6: an ordered list of steps, an approval checkpoint after the
// turnaround, and a folder of separate reference files each with role and view
// sidecar tags. One photo yields an anchor plus the six turnaround views as
// their own files; an expression grid and outfit or state variants follow. The
// full workflow DSL is a later milestone; this planner is the subset F-CHR-04
// needs and is unit-tested on its own.

import { T1_SHEET_A, T2_SHEET_B, T3_EXPRESSIONS, renderSheetPrompt } from './sheet-prompts.js';

// The seven turnaround views, in the order they appear across the two row
// sheets, then the full-body shot (PRD-07 §5.6).
export type SheetView =
  | 'front'
  | 'three_quarter_left'
  | 'profile_left'
  | 'back'
  | 'three_quarter_right'
  | 'profile_right'
  | 'full_body';

export const ALL_VIEWS: SheetView[] = [
  'front',
  'three_quarter_left',
  'profile_left',
  'back',
  'three_quarter_right',
  'profile_right',
  'full_body',
];

// The two row sheets and which views each is cut into (PRD-07 §5.6).
export const SHEET_A_VIEWS: SheetView[] = ['front', 'three_quarter_left', 'profile_left', 'back'];
export const SHEET_B_VIEWS: SheetView[] = ['three_quarter_right', 'profile_right'];

// The nine expression cells, row-major (PRD-07 §5.5).
export const EXPRESSIONS = [
  'neutral',
  'gentle smile',
  'laughing',
  'surprised',
  'angry',
  'sad',
  'thoughtful',
  'determined',
  'shouting',
];

// The reference file name for a turnaround view (PRD-07 §5.6).
export function viewFileName(view: SheetView): string {
  return `turnaround_${view}.png`;
}

// One step in the pipeline. `approval` marks the checkpoint after the turnaround
// where the run pauses for the owner to approve before spending on the rest.
export interface SheetStep {
  id: string;
  kind: 'generate' | 'split' | 'approval' | 'register';
  name: string;
  // For a generate step: the prompt and how many panels the sheet is cut into.
  prompt?: string;
  panels?: SheetView[];
  // For a register step: the reference role and views written to sidecars.
  role?: 'anchor' | 'turnaround' | 'expression' | 'outfit' | 'state';
}

export interface SheetPlanInput {
  short: string;
  views?: SheetView[];
  expressions?: boolean;
  outfits?: Array<{ label: string }>;
  states?: Array<{ label: string }>;
}

// Build the ordered step plan. The turnaround sheets and their split come first,
// then the approval checkpoint, then the expression grid and any variants — so
// no expression or variant is generated until the turnaround is approved.
export function planSheet(input: SheetPlanInput): SheetStep[] {
  const wanted = new Set(input.views ?? ALL_VIEWS);
  const sheetA = SHEET_A_VIEWS.filter((view) => wanted.has(view));
  const sheetB = SHEET_B_VIEWS.filter((view) => wanted.has(view));
  const steps: SheetStep[] = [];

  if (sheetA.length > 0) {
    steps.push({
      id: 'sheet_a',
      kind: 'generate',
      name: 'Turnaround sheet A',
      prompt: renderSheetPrompt(T1_SHEET_A, input.short),
      panels: sheetA,
    });
    steps.push({ id: 'split_a', kind: 'split', name: 'Cut sheet A into views', panels: sheetA });
  }
  if (sheetB.length > 0) {
    steps.push({
      id: 'sheet_b',
      kind: 'generate',
      name: 'Turnaround sheet B',
      prompt: renderSheetPrompt(T2_SHEET_B, input.short),
      panels: sheetB,
    });
    steps.push({ id: 'split_b', kind: 'split', name: 'Cut sheet B into views', panels: sheetB });
  }

  steps.push({
    id: 'register_turnaround',
    kind: 'register',
    name: 'Register the turnaround views',
    role: 'turnaround',
    panels: [...sheetA, ...sheetB],
  });

  // The approval checkpoint: everything above is the turnaround; the owner
  // approves it before Kilnry spends on the expression grid and variants.
  steps.push({ id: 'approve_turnaround', kind: 'approval', name: 'Approve the turnaround' });

  if (input.expressions !== false) {
    steps.push({
      id: 'expressions',
      kind: 'generate',
      name: 'Expression grid',
      prompt: renderSheetPrompt(T3_EXPRESSIONS, input.short),
    });
    steps.push({
      id: 'register_expressions',
      kind: 'register',
      name: 'Register the expressions',
      role: 'expression',
    });
  }
  for (const outfit of input.outfits ?? []) {
    steps.push({
      id: `outfit_${outfit.label}`,
      kind: 'generate',
      name: `Outfit: ${outfit.label}`,
      role: 'outfit',
    });
  }
  for (const state of input.states ?? []) {
    steps.push({
      id: `state_${state.label}`,
      kind: 'generate',
      name: `State: ${state.label}`,
      role: 'state',
    });
  }

  return steps;
}

// The index of the approval checkpoint in a plan (for the run to pause on it).
export function approvalIndex(steps: SheetStep[]): number {
  return steps.findIndex((step) => step.kind === 'approval');
}

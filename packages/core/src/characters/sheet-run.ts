// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The reference-sheet run: the minimal linear executor from TRD-12 §6 applied to
// the F-CHR-04 pipeline. It persists a run and its steps, drives each generate
// step through the job engine with the anchor as the reference image (so the
// same estimate, budget and confirmation rules apply), cuts each finished row
// sheet into its panels, writes every view as its own file under the Character's
// folder with a sidecar carrying role "reference" and the view tag plus lineage
// to the anchor, and pauses at the approval checkpoint. On approval it continues
// with the expression grid and any outfit or state variants.

import { and, eq } from 'drizzle-orm';
import { runSteps, runs, type DatabaseState } from '@kilnry/db';
import { KilnryError } from '../errors.js';
import { ulid } from '../ids.js';
import { planSheet, viewFileName, type SheetPlanInput, type SheetStep, type SheetView } from './sheet.js';

export type SheetRunStatus = 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'cancelled';

// What the executor needs from the job engine: submit a generate job with the
// anchor as a reference and later read the job's output asset.
export interface SheetEngine {
  createJob(input: {
    request: Record<string, unknown>;
    confirmed_cost_usd?: number;
    confirmed_by: string;
    client_request_id?: string;
  }): Promise<{ job_id: string; status: string }>;
}

// What the executor needs to turn a finished sheet asset into per-view files.
export interface SheetSink {
  // The on-disk path of a completed job's first output asset.
  assetPath(assetId: string): Promise<string | null>;
  // The output asset ids of a job, or null while it is not yet completed.
  jobOutputs(jobId: string): Promise<{ status: string; assetIds: string[] }>;
  // Cut a row sheet into equal panels written to the given paths.
  split(inputPath: string, outputs: string[]): Promise<string[]>;
  // Index a written file as an asset with role/view/lineage and register it on
  // the Character; returns the new asset id.
  registerView(input: {
    characterId: string;
    path: string;
    view: SheetView;
    anchorAssetId: string | null;
  }): Promise<string>;
}

// Start a run: plan the steps, write the run and its step rows, submit the first
// turnaround sheet job with the anchor as a reference. Returns the run id and the
// planned steps.
export async function startSheetRun(
  db: DatabaseState,
  engine: SheetEngine,
  input: SheetPlanInput & {
    characterId: string;
    anchorAssetId: string | null;
    folder: string;
    model?: string;
  },
): Promise<{ run_id: string; steps: SheetStep[] }> {
  const steps = planSheet(input);
  const runId = ulid();
  await db.db.insert(runs).values({
    id: runId,
    workflowId: 'kilnry-character-sheet',
    workflowVersion: '1.0.0',
    status: 'running' satisfies SheetRunStatus,
    inputs: { character_id: input.characterId, anchor_asset_id: input.anchorAssetId },
    plan: { steps: steps.map((step) => ({ id: step.id, kind: step.kind, name: step.name })) },
    folder: input.folder,
    source: 'sheet',
  });
  for (const [position, step] of steps.entries()) {
    const stepInputs: Record<string, unknown> = {};
    if (step.prompt) stepInputs.prompt = step.prompt;
    if (step.panels) stepInputs.panels = step.panels;
    await db.db.insert(runSteps).values({
      runId,
      stepId: step.id,
      position,
      name: step.name,
      kind: step.kind,
      status: 'pending',
      approvalRequired: step.kind === 'approval',
      ...(Object.keys(stepInputs).length > 0 ? { inputs: stepInputs } : {}),
    });
  }
  await submitFirstStep(db, engine, runId, steps, input);
  return { run_id: runId, steps };
}

// Submit the first generate step if there is one; failures are non-fatal here so
// the plan is always returned and the run can be advanced or retried later.
async function submitFirstStep(
  db: DatabaseState,
  engine: SheetEngine,
  runId: string,
  steps: SheetStep[],
  input: { anchorAssetId: string | null; model?: string },
): Promise<void> {
  const first = steps.find((step) => step.kind === 'generate');
  if (!first) return;
  try {
    await submitGenerate(db, engine, runId, first.id, input);
  } catch {
    // Leave the step pending; advanceSheetRun will retry the submission.
  }
}

// Submit a generate step's job with the anchor as a reference image and mark the
// step running with its job id. Only generate steps submit; other kinds advance
// in the loop.
async function submitGenerate(
  db: DatabaseState,
  engine: SheetEngine,
  runId: string,
  stepId: string,
  input: { anchorAssetId: string | null; model?: string },
): Promise<void> {
  const [row] = await db.db
    .select()
    .from(runSteps)
    .where(and(eq(runSteps.runId, runId), eq(runSteps.stepId, stepId)))
    .limit(1);
  if (!row || row.kind !== 'generate') return;
  const prompt = String((row.inputs as { prompt?: string } | null)?.prompt ?? '');
  const job = await engine.createJob({
    request: {
      kind: 'image_edit',
      prompt,
      ...(input.model && input.model !== 'auto' ? { model: input.model } : {}),
      params: { quality: 'high', aspect_ratio: '3:4' },
      medias: input.anchorAssetId ? [{ role: 'reference', ref: input.anchorAssetId }] : [],
      count: 1,
      injections: [],
    },
    // The user clicked Run and confirmed the sheet's cost, so the job is confirmed
    // by the user (TRD-04's confirmed_by set is user | auto | mcp:<token_id>).
    confirmed_by: 'user',
    client_request_id: `${runId}:${stepId}`,
  });
  await db.db
    .update(runSteps)
    .set({ status: 'running', jobId: job.job_id })
    .where(and(eq(runSteps.runId, runId), eq(runSteps.stepId, stepId)));
}

// The step ids in run order.
async function orderedSteps(db: DatabaseState, runId: string): Promise<Array<typeof runSteps.$inferSelect>> {
  const rows = await db.db.select().from(runSteps).where(eq(runSteps.runId, runId));
  return rows.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

// Advance the run: complete any finished generate step (split its sheet into
// views and register them), then move to the next pending step; a generate step
// submits a job, a split/register step runs inline, an approval step pauses the
// run. Idempotent; safe to call on every job event.
export async function advanceSheetRun(
  db: DatabaseState,
  engine: SheetEngine,
  sink: SheetSink,
  runId: string,
): Promise<SheetRunStatus> {
  const [run] = await db.db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) throw new KilnryError('NOT_FOUND', 'Sheet run not found.');
  if (run.status === 'awaiting_approval') return 'awaiting_approval';

  const characterId = String((run.inputs as { character_id?: string }).character_id ?? '');
  const anchorAssetId = ((run.inputs as { anchor_asset_id?: string | null }).anchor_asset_id ?? null) as
    string | null;
  const model = String((run.inputs as { model?: string }).model ?? 'auto');

  const steps = await orderedSteps(db, runId);
  for (const step of steps) {
    if (step.status === 'completed' || step.status === 'skipped') continue;

    // A running generate step: check its job and, when complete, split + register.
    if (step.kind === 'generate' && step.status === 'running' && step.jobId) {
      const outputs = await sink.jobOutputs(step.jobId);
      if (['failed', 'moderated', 'cancelled'].includes(outputs.status)) {
        await setStep(db, runId, step.stepId, 'failed');
        await db.db.update(runs).set({ status: 'failed' }).where(eq(runs.id, runId));
        return 'failed';
      }
      if (outputs.status !== 'completed') return 'running';
      await setStep(db, runId, step.stepId, 'completed', { sheet_asset_id: outputs.assetIds[0] ?? null });
      continue;
    }
    if (step.status === 'running') return 'running';

    // A pending step is ready when every earlier step is done.
    if (step.status !== 'pending') continue;

    if (step.kind === 'approval') {
      await setStep(db, runId, step.stepId, 'waiting');
      await db.db.update(runs).set({ status: 'awaiting_approval' }).where(eq(runs.id, runId));
      return 'awaiting_approval';
    }
    if (step.kind === 'generate') {
      await submitGenerate(db, engine, runId, step.stepId, { anchorAssetId, model });
      return 'running';
    }
    if (step.kind === 'split') {
      await runSplit(db, sink, runId, step, characterId, anchorAssetId);
      await setStep(db, runId, step.stepId, 'completed');
      continue;
    }
    // register and any other bookkeeping step completes inline.
    await setStep(db, runId, step.stepId, 'completed');
  }

  await db.db.update(runs).set({ status: 'completed', finishedAt: new Date() }).where(eq(runs.id, runId));
  return 'completed';
}

// Cut the sheet produced by the matching generate step into its view files and
// register each on the Character with role "reference", the view tag, and
// lineage to the anchor.
async function runSplit(
  db: DatabaseState,
  sink: SheetSink,
  runId: string,
  step: typeof runSteps.$inferSelect,
  characterId: string,
  anchorAssetId: string | null,
): Promise<void> {
  const panels = ((step.inputs as { panels?: SheetView[] } | null)?.panels ?? []) as SheetView[];
  if (panels.length === 0) return;
  const sheetStepId = step.stepId === 'split_a' ? 'sheet_a' : 'sheet_b';
  const [sheetStep] = await db.db
    .select()
    .from(runSteps)
    .where(and(eq(runSteps.runId, runId), eq(runSteps.stepId, sheetStepId)))
    .limit(1);
  const sheetAssetId = (sheetStep?.outputs as { sheet_asset_id?: string } | null)?.sheet_asset_id;
  if (!sheetAssetId) return;
  const sheetPath = await sink.assetPath(sheetAssetId);
  if (!sheetPath) return;

  const outputs = panels.map((view) => sheetPath.replace(/[^/]+$/, viewFileName(view)));
  const written = await sink.split(sheetPath, outputs);
  for (const [index, path] of written.entries()) {
    const view = panels[index]!;
    await sink.registerView({ characterId, path, view, anchorAssetId });
  }
}

async function setStep(
  db: DatabaseState,
  runId: string,
  stepId: string,
  status: string,
  outputs?: Record<string, unknown>,
): Promise<void> {
  await db.db
    .update(runSteps)
    .set({ status, ...(outputs ? { outputs } : {}) })
    .where(and(eq(runSteps.runId, runId), eq(runSteps.stepId, stepId)));
}

// Approve the turnaround: mark the approval step approved and let the run
// continue with the expression grid and variants.
export async function approveSheetRun(
  db: DatabaseState,
  engine: SheetEngine,
  sink: SheetSink,
  runId: string,
): Promise<SheetRunStatus> {
  const steps = await orderedSteps(db, runId);
  const approval = steps.find((step) => step.kind === 'approval' && step.status === 'waiting');
  if (!approval) throw new KilnryError('INVALID_INPUT', 'This run is not waiting for approval.');
  await db.db
    .update(runSteps)
    .set({ status: 'completed', approvedAt: new Date(), decidedBy: 'owner' })
    .where(and(eq(runSteps.runId, runId), eq(runSteps.stepId, approval.stepId)));
  await db.db.update(runs).set({ status: 'running' }).where(eq(runs.id, runId));
  return advanceSheetRun(db, engine, sink, runId);
}

// Deny the turnaround: stop the run; completed views stay on disk.
export async function denySheetRun(db: DatabaseState, runId: string): Promise<SheetRunStatus> {
  const steps = await orderedSteps(db, runId);
  for (const step of steps) {
    if (step.status === 'pending' || step.status === 'waiting') {
      await setStep(db, runId, step.stepId, 'cancelled');
    }
  }
  await db.db.update(runs).set({ status: 'cancelled', finishedAt: new Date() }).where(eq(runs.id, runId));
  return 'cancelled';
}

// Read a run and its steps for the detail page.
export async function getSheetRun(
  db: DatabaseState,
  runId: string,
): Promise<{
  status: SheetRunStatus;
  steps: Array<{ id: string; name: string; kind: string; status: string }>;
}> {
  const [run] = await db.db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) throw new KilnryError('NOT_FOUND', 'Sheet run not found.');
  const steps = await orderedSteps(db, runId);
  return {
    status: run.status as SheetRunStatus,
    steps: steps.map((step) => ({
      id: step.stepId,
      name: step.name ?? step.stepId,
      kind: step.kind ?? '',
      status: step.status ?? 'pending',
    })),
  };
}

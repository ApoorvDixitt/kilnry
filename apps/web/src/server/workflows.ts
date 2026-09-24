// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The workflow host runner (F-WFL-01/02/03, TRD-12 §6). It is the seam between
// the pure @kilnry/workflows engine and the running app: it loads the catalogue,
// plans a workflow by routing and estimating every spending leaf through the one
// estimator every other spend uses, and executes a run by driving every generate,
// transform and analyze step through engine.createJob — so each spending step
// goes through the same estimate → confirm → reserve → ledger road, writing
// exactly one spend-ledger row and one audit event, with source 'workflow' and
// the run and step id carried onto the job (and its output sidecar) for the
// manifest and reindex. The executor's effects never call a provider adapter
// directly (TRD-12 §6): a step that spends is always a createJob call.
//
// A run starts only against a fresh plan: the confirmed total must be at least
// nine tenths of the plan's estimate, or the plan must be under fifteen minutes
// old (TRD-10 §3.5). Job terminal state maps to the step's status, outputs and
// actual cost, and the run's spent total accumulates. On resume the ready set is
// rebuilt from run_steps and a live job is re-attached by its provider request
// id rather than resubmitted (F-JOB-05).

import { readFileSync, readdirSync, mkdirSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { KilnryError, loadConfig, ulid } from '@kilnry/core';
import { CanonicalRequestSchema, type CanonicalRequest, type RouteConstraints } from '@kilnry/core';
import { assets, runSteps, runs, type DatabaseState } from '@kilnry/db';
import {
  buildManifest,
  execute,
  expandRunState,
  parseWorkflow,
  plan,
  renderStep,
  resetFrom,
  runFolder,
  validateWorkflowFile,
  type Effects,
  type Plan,
  type PlanContext,
  type RunState,
  type RunStep,
  type Scope,
  type Step,
  type StepResult,
  type WorkflowFile,
} from '@kilnry/workflows';
import type { JobEngine } from '@kilnry/core/jobs';
import { canonicalGeneration, GenerationInput } from './generation-input';

// ── catalogue ────────────────────────────────────────────────────────────────

/** The bundled catalogue folder inside the workflows package. */
function bundledCatalogueRoot(): string {
  // server/workflows.ts → resolve the installed @kilnry/workflows/catalogue.
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '..', '..', '..', 'packages', 'workflows', 'catalogue'),
    join(here, '..', '..', 'node_modules', '@kilnry', 'workflows', 'catalogue'),
  ];
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  return candidates[0]!;
}

/** The user's own workflow folder under the data dir. */
function userCatalogueRoot(dataDir: string): string {
  return join(dataDir, 'workflows');
}

function catalogueRoots(dataDir: string): string[] {
  return [bundledCatalogueRoot(), userCatalogueRoot(dataDir)];
}

interface CatalogueEntry {
  id: string;
  workflow: WorkflowFile;
  yaml: string;
}

/** Load and parse every workflow YAML, later roots shadowing earlier ones by id. */
export function loadCatalogue(dataDir: string): Map<string, CatalogueEntry> {
  const byId = new Map<string, CatalogueEntry>();
  for (const root of catalogueRoots(dataDir)) {
    let files: string[];
    try {
      files = readdirSync(root).filter((name) => /\.ya?ml$/i.test(name));
    } catch {
      continue;
    }
    for (const file of files) {
      const yaml = readFileSync(join(root, file), 'utf8');
      try {
        const workflow = parseWorkflow(yaml);
        byId.set(workflow.id, { id: workflow.id, workflow, yaml });
      } catch {
        // A malformed catalogue file is skipped; validate.ts / the CLI report it.
      }
    }
  }
  return byId;
}

export function getWorkflow(dataDir: string, id: string): CatalogueEntry | undefined {
  return loadCatalogue(dataDir).get(id);
}

// ── planning ─────────────────────────────────────────────────────────────────

/**
 * Build a PlanContext bound to the engine: priceStep routes and estimates a
 * spending step through engine.estimate (which never spends), so the plan uses
 * the same prices as an actual run.
 */
function planContext(): PlanContext {
  return {
    // Inputs default and validate against the workflow's JSON Schema. A full
    // JSON-Schema validation is layered in the drawer; here defaults are applied
    // and required inputs are trusted (the route validates the payload shape).
    resolveInputs: (_workflow, inputs) => inputs,
    // The synchronous planner only expands the graph; pricePlan then estimates
    // each spending leaf through the engine for the real total.
    priceStep: () => ({ estimate_usd: 0, eta_s: 0, why: 'priced at run' }),
  };
}

/** Plan a workflow and persist the plan so a run can check its freshness. */
export async function planWorkflow(
  db: DatabaseState,
  engine: JobEngine,
  dataDir: string,
  workflowId: string,
  inputs: Record<string, unknown>,
): Promise<{ run_id: string; plan: Plan }> {
  const entry = getWorkflow(dataDir, workflowId);
  if (!entry) throw new KilnryError('NOT_FOUND', `No workflow called ${workflowId} is installed.`);

  const ctx = planContext();
  // Price each spending leaf through the engine estimate for the real total.
  const priced = await pricePlan(engine, entry.workflow, inputs, ctx);
  const runId = ulid();
  await db.db.insert(runs).values({
    id: runId,
    workflowId: entry.workflow.id,
    workflowVersion: entry.workflow.version,
    status: 'planning',
    inputs,
    plan: priced as unknown as Record<string, unknown>,
    estimateUsd: priced.total_estimate_usd.toFixed(6),
    source: 'workflow',
  });
  return { run_id: runId, plan: priced };
}

// Price the plan by routing/estimating each spending step through the engine.
async function pricePlan(
  engine: JobEngine,
  workflow: WorkflowFile,
  inputs: Record<string, unknown>,
  ctx: PlanContext,
): Promise<Plan> {
  // First pass with the synchronous planner to expand the graph and vars.
  const base = plan(workflow, inputs, ctx);
  // Second pass: estimate each spending step through the engine for real prices.
  let total = 0;
  let eta = 0;
  for (const step of base.steps) {
    if (step.kind !== 'generate' && step.kind !== 'transform' && step.kind !== 'analyze') continue;
    try {
      const wfStep = findStep(workflow.steps, step.step_id);
      if (!wfStep) continue;
      const scope = { inputs: base.inputs, defaults: workflow.defaults, vars: base.vars } as Scope;
      const canonical = canonicalRequestForStep(wfStep, scope);
      const prepared = await engine.estimate(canonical.request, canonical.constraints);
      step.estimate_usd = prepared.estimate.estimate_usd;
      step.eta_s = prepared.estimate.eta_s;
      step.model = prepared.estimate.route.model;
      step.provider = prepared.estimate.route.provider;
      total += prepared.estimate.estimate_usd;
      eta += prepared.estimate.eta_s;
    } catch {
      base.warnings.push(`step ${step.step_id} has no provider`);
    }
  }
  base.total_estimate_usd = Math.round(total * 1_000_000) / 1_000_000;
  base.eta_s = Math.round(eta);
  return base;
}

// Find a step (including nested) by its id.
function findStep(steps: Step[], id: string): Step | undefined {
  for (const step of steps) {
    if (step.id === id) return step;
    if (step.kind === 'branch') {
      const found = findStep(step.then, id) ?? findStep(step.else, id);
      if (found) return found;
    } else if (step.kind === 'foreach') {
      const found = findStep(step.steps, id);
      if (found) return found;
    }
  }
  return undefined;
}

// Map a workflow transform op to the routable capability, media kind and the
// role the source takes, exactly as apps/web/src/app/api/transform/route.ts does
// for the transforms panel, so a transform step routes and prices through the
// same estimator every other spend uses (TRD-12 §6, F-CRE-11). Dubbing and voice
// change are text-to-speech models the registry tags, so they carry the tts
// capability and a tag constraint rather than a first-class capability.
const TRANSFORM_CAPABILITY: Record<string, string> = {
  upscale: 'upscale_image',
  bg_remove: 'bg_remove',
  reframe: 'reframe_image',
  outpaint: 'outpaint',
  lipsync: 'lipsync',
  transcribe: 'stt',
  dubbing: 'tts',
  voice_change: 'tts',
};
const TRANSFORM_KIND: Record<string, 'image' | 'video' | 'audio'> = {
  lipsync: 'video',
  transcribe: 'audio',
  dubbing: 'audio',
  voice_change: 'audio',
};
const TRANSFORM_SOURCE_ROLE: Record<string, 'video' | 'audio' | 'reference'> = {
  lipsync: 'video',
  transcribe: 'audio',
  dubbing: 'audio',
  voice_change: 'audio',
};
const TRANSFORM_TAG: Record<string, string> = { dubbing: 'dubbing', voice_change: 'voice_change' };
const TRANSFORM_MODEL: Record<string, string> = { dubbing: 'dubbing_v2', voice_change: 'voice_changer' };

// A canonical request plus its route constraints, the shape engine.estimate and
// engine.createJob read. Transform and analyze build one directly (with an
// explicit capability) rather than through canonicalGeneration, whose capability
// is inferred from the media kind and so cannot express bg_remove or stt.
interface CanonicalForStep {
  request: CanonicalRequest & { source: 'workflow'; target_folder: string };
  constraints: RouteConstraints;
}

// A rendered MediaRef that is a non-empty asset id.
function refToAsset(ref: unknown): string | undefined {
  return ref === null || ref === undefined || ref === '' ? undefined : String(ref);
}

// Build the CanonicalRequest for a rendered transform step (TRD-12 §6). The
// source becomes the media the estimator and adapter read; the op decides the
// capability, media kind and source role.
function canonicalForTransform(rendered: Extract<Step, { kind: 'transform' }>): CanonicalForStep {
  const op = rendered.op;
  const capability = TRANSFORM_CAPABILITY[op] ?? 'upscale_image';
  const kind = TRANSFORM_KIND[op] ?? 'image';
  const supplied: Record<string, unknown> = { ...(rendered.params ?? {}) };
  const clipSeconds = typeof supplied.clip_seconds === 'number' ? supplied.clip_seconds : undefined;
  const aspectRatio = typeof supplied.aspect_ratio === 'string' ? supplied.aspect_ratio : undefined;
  const extraAudio = typeof supplied.audio === 'string' ? supplied.audio.trim() : '';
  delete supplied.clip_seconds;
  delete supplied.aspect_ratio;
  delete supplied.audio;
  const pinned = TRANSFORM_MODEL[op] ?? (rendered.model !== 'auto' ? rendered.model : undefined);
  const tag = TRANSFORM_TAG[op];
  const medias: Array<{ role: string; asset_id: string }> = [];
  const source = refToAsset(rendered.source);
  if (source) medias.push({ role: TRANSFORM_SOURCE_ROLE[op] ?? 'reference', asset_id: source });
  if (op === 'lipsync' && extraAudio !== '') medias.push({ role: 'audio', asset_id: extraAudio });
  const request = CanonicalRequestSchema.parse({
    kind,
    capability,
    prompt: op,
    params: {
      ...(aspectRatio === undefined ? {} : { aspect_ratio: aspectRatio }),
      ...(clipSeconds === undefined || clipSeconds <= 0 ? {} : { duration_s: clipSeconds }),
      ...(Object.keys(supplied).length === 0 ? {} : { extra: supplied }),
    },
    medias,
    injections: [],
    count: 1,
    target_folder: 'inbox',
    source: 'workflow',
  }) as CanonicalForStep['request'];
  return {
    request,
    constraints: {
      ...(pinned === undefined ? {} : { pinned_model: pinned }),
      ...(tag === undefined ? {} : { tags: [tag] }),
      refs_count: medias.filter((media) => ['reference', 'product'].includes(media.role)).length,
      ...(clipSeconds === undefined ? {} : { duration_s: clipSeconds }),
      ...(aspectRatio === undefined ? {} : { aspect_ratio: aspectRatio }),
    },
  };
}

// Build the CanonicalRequest for a rendered analyze step (TRD-12 §6, §4 table).
// With refs it is a vision-language-model (VLM) task over those media; with no
// refs it is a text-only large-language-model (LLM) call metered as an llm spend
// (same model resolution as Chat). The instructions and task become the prompt.
function canonicalForAnalyze(rendered: Extract<Step, { kind: 'analyze' }>): CanonicalForStep {
  const refs = Array.isArray(rendered.refs)
    ? rendered.refs.map(refToAsset).filter((id): id is string => id !== undefined)
    : [];
  const capability = refs.length > 0 ? 'vlm' : 'llm';
  const instructions = typeof rendered.instructions === 'string' ? rendered.instructions : '';
  const prompt = `${rendered.task}${instructions === '' ? '' : `: ${instructions}`}`;
  const pinned = rendered.model !== 'auto' ? rendered.model : undefined;
  const request = CanonicalRequestSchema.parse({
    kind: 'image',
    capability,
    prompt: prompt.slice(0, 20_000) || rendered.task,
    params: rendered.schema === undefined ? {} : { extra: { schema: rendered.schema } },
    medias: refs.map((asset_id) => ({ role: 'reference', asset_id })),
    injections: [],
    count: 1,
    target_folder: 'inbox',
    source: 'workflow',
  }) as CanonicalForStep['request'];
  return {
    request,
    constraints: {
      ...(pinned === undefined ? {} : { pinned_model: pinned }),
      refs_count: refs.length,
    },
  };
}

// Build a CanonicalRequest for a generate/transform/analyze step under a scope.
// generate goes through canonicalGeneration (capability inferred from kind and
// medias); transform and analyze build the request directly with an explicit
// capability so each routes and prices as its own tool (TRD-12 §6).
function canonicalRequestForStep(step: Step, scope: Scope): CanonicalForStep {
  const rendered = renderStep(step, scope);
  if (rendered.kind === 'transform') return canonicalForTransform(rendered);
  if (rendered.kind === 'analyze') return canonicalForAnalyze(rendered);
  const generate = rendered as Extract<Step, { kind: 'generate' }>;
  const medias = Array.isArray(generate.medias)
    ? generate.medias
        .filter((media) => media.ref !== null && media.ref !== undefined && media.ref !== '')
        .map((media) => ({ role: media.role, asset_id: String(media.ref) }))
    : [];
  // A generate step's params mix canonical routing params (aspect ratio,
  // resolution, duration, seed, audio, language) with free provider params. Keep
  // the canonical ones at the top level and route the rest — including a
  // provider-specific quality that is not the canonical draft/standard/premium
  // enum — through `extra`, so the request validates.
  const CANONICAL_PARAM_KEYS = new Set([
    'aspect_ratio',
    'width',
    'height',
    'resolution',
    'duration_s',
    'seed',
    'audio',
    'language',
    'voice',
  ]);
  const QUALITY_TIERS = new Set(['draft', 'standard', 'premium']);
  const rawParams =
    generate.params !== null && typeof generate.params === 'object'
      ? (generate.params as Record<string, unknown>)
      : {};
  const params: Record<string, unknown> = {};
  const extra: Record<string, unknown> =
    typeof rawParams.extra === 'object' && rawParams.extra !== null
      ? { ...(rawParams.extra as Record<string, unknown>) }
      : {};
  for (const [key, value] of Object.entries(rawParams)) {
    if (key === 'extra') continue;
    if (key === 'quality' && QUALITY_TIERS.has(String(value))) params.quality = value;
    else if (CANONICAL_PARAM_KEYS.has(key)) params[key] = value;
    else extra[key] = value;
  }
  if (Object.keys(extra).length > 0) params.extra = extra;
  const canonical = canonicalGeneration(
    GenerationInput.parse({
      kind: generate.kind_of ?? 'image',
      prompt: String(generate.prompt || 'workflow step'),
      ...(generate.negative_prompt === undefined
        ? {}
        : { negative_prompt: String(generate.negative_prompt) }),
      model: typeof generate.model === 'string' ? generate.model : 'auto',
      params,
      medias,
      count: typeof generate.count === 'number' ? generate.count : 1,
      target_folder: 'inbox',
      source: 'ui',
    }),
  );
  return {
    request: { ...canonical.request, source: 'workflow', target_folder: 'inbox' },
    constraints: canonical.constraints,
  };
}

// The exact createJob input for a spending step: source 'workflow', the run and
// step id, the run folder as the target, and the plan step's estimate as the
// confirmed cost. Exported and pure so the money path is unit-testable against a
// fake engine that counts submits and ledger writes (TRD-12 §6).
export interface SpendJobInput {
  request: CanonicalRequest & { source: 'workflow'; target_folder: string };
  constraints: RouteConstraints;
  confirmed_cost_usd: number;
  confirmed_by: 'user';
  run_id: string;
  step_id: string;
  client_request_id: string;
}

export function buildSpendInput(
  runId: string,
  folder: string,
  node: RunStep,
  rendered: Step,
  scope: Scope,
  confirmedCostUsd: number,
): SpendJobInput {
  const canonical = canonicalRequestForStep(rendered, scope);
  return {
    request: { ...canonical.request, source: 'workflow', target_folder: folder },
    constraints: canonical.constraints,
    confirmed_cost_usd: confirmedCostUsd,
    confirmed_by: 'user',
    run_id: runId,
    step_id: node.step_id,
    client_request_id: `${runId}:${node.instance_id}`,
  };
}

// ── running ──────────────────────────────────────────────────────────────────
/** Assert a plan is fresh enough to run (TRD-10 §3.5). */
function assertFreshPlan(persistedPlan: Plan, confirmCostUsd: number, now: Date): void {
  const ageMs = now.getTime() - new Date(persistedPlan.created_at).getTime();
  const fresh = ageMs <= 15 * 60_000;
  const confirmedEnough = confirmCostUsd >= 0.9 * persistedPlan.total_estimate_usd;
  if (!fresh && !confirmedEnough) {
    throw new KilnryError(
      'INVALID_INPUT',
      'This plan is more than fifteen minutes old. Re-plan the workflow before running it.',
    );
  }
}

/**
 * Start a run against a persisted plan. Verifies the plan is fresh, writes the
 * run_steps rows, and drives the executor: every spending step goes through
 * engine.createJob with source 'workflow', the run and step id and the plan
 * step's estimate as the confirmed cost; a checkpoint pauses the run.
 */
export async function startRun(
  db: DatabaseState,
  engine: JobEngine,
  dataDir: string,
  runId: string,
  confirmCostUsd: number,
  options: { automatic?: boolean; skipApprovals?: boolean; targetFolder?: string } = {},
): Promise<RunState> {
  const [run] = await db.db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) throw new KilnryError('NOT_FOUND', 'Run not found.');
  const persistedPlan = run.plan as unknown as Plan;
  assertFreshPlan(persistedPlan, confirmCostUsd, new Date());

  const entry = getWorkflow(dataDir, run.workflowId);
  if (!entry) throw new KilnryError('NOT_FOUND', `Workflow ${run.workflowId} is no longer installed.`);

  const config = await loadConfig();
  const project = options.targetFolder ?? (run.inputs as { folder?: string }).folder;
  const folder = run.folder ?? runFolder(entry.workflow, project === undefined ? {} : { project });
  const startedAt = run.createdAt.toISOString();
  await db.db.update(runs).set({ status: 'running', folder }).where(eq(runs.id, runId));

  const baseScope: Scope = {
    inputs: persistedPlan.inputs,
    defaults: entry.workflow.defaults,
    vars: persistedPlan.vars,
    run: { id: runId, folder, workflow: entry.workflow.id },
  };

  const effects = runEffects(db, engine, {
    runId,
    plan: persistedPlan,
    workflow: entry.workflow,
    folder,
    startedAt,
    libraryRoot: config.library_root ?? '',
  });

  const state = await execute(entry.workflow, baseScope, effects, options);
  await persistRun(
    db,
    engine,
    runId,
    entry.workflow,
    persistedPlan,
    state,
    folder,
    startedAt,
    config.library_root,
  );
  return state;
}

// Rebuild the run's base scope from its persisted plan and folder.
function buildBaseScope(runId: string, folder: string, workflow: WorkflowFile, persistedPlan: Plan): Scope {
  return {
    inputs: persistedPlan.inputs,
    defaults: workflow.defaults,
    vars: persistedPlan.vars,
    run: { id: runId, folder, workflow: workflow.id },
  };
}

// Rebuild the run's node graph and overlay the persisted status and outputs from
// run_steps, so a resumed run never re-runs a completed step. A step with a live
// job id keeps it (re-attached, not resubmitted).
async function rebuildRunState(
  db: DatabaseState,
  runId: string,
  workflow: WorkflowFile,
  baseScope: Scope,
): Promise<RunState> {
  const state = expandRunState(workflow, baseScope);
  const rows = await db.db.select().from(runSteps).where(eq(runSteps.runId, runId));
  const byId = new Map(rows.map((row) => [row.stepId, row] as const));
  let spent = 0;
  for (const node of state.steps) {
    const row = byId.get(node.step_id);
    if (!row) continue;
    node.status = (row.status ?? 'pending') as RunStep['status'];
    if (row.outputs) node.outputs = row.outputs;
    if (row.modelId) node.model = row.modelId;
    if (row.provider) node.provider = row.provider;
    if (row.actualUsd) node.actual_usd = Number(row.actualUsd);
    if (Array.isArray(row.adjustments)) node.adjustments = row.adjustments as string[];
    node.attempts = row.attempts ?? 0;
    spent += Number(row.actualUsd ?? 0);
  }
  state.spent_usd = spent;
  return state;
}

// Continue a run from its persisted state after a decision or a reset.
async function driveResumed(
  db: DatabaseState,
  engine: JobEngine,
  dataDir: string,
  runId: string,
  options: { automatic?: boolean; skipApprovals?: boolean } = {},
): Promise<RunState> {
  const [run] = await db.db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) throw new KilnryError('NOT_FOUND', 'Run not found.');
  const entry = getWorkflow(dataDir, run.workflowId);
  if (!entry) throw new KilnryError('NOT_FOUND', `Workflow ${run.workflowId} is no longer installed.`);
  const persistedPlan = run.plan as unknown as Plan;
  const config = await loadConfig();
  const folder = run.folder ?? runFolder(entry.workflow, {});
  const startedAt = run.createdAt.toISOString();
  const baseScope = buildBaseScope(runId, folder, entry.workflow, persistedPlan);
  const existing = await rebuildRunState(db, runId, entry.workflow, baseScope);
  const effects = runEffects(db, engine, {
    runId,
    plan: persistedPlan,
    workflow: entry.workflow,
    folder,
    startedAt,
    libraryRoot: config.library_root ?? '',
  });
  const state = await execute(entry.workflow, baseScope, effects, options, existing);
  await persistRun(
    db,
    engine,
    runId,
    entry.workflow,
    persistedPlan,
    state,
    folder,
    startedAt,
    config.library_root,
  );
  return state;
}

/** Approve the waiting checkpoint and continue the run (F-WFL-04). */
export async function approveRun(
  db: DatabaseState,
  engine: JobEngine,
  dataDir: string,
  runId: string,
): Promise<RunState> {
  const waiting = await db.db
    .select()
    .from(runSteps)
    .where(and(eq(runSteps.runId, runId), eq(runSteps.status, 'waiting')));
  if (waiting.length === 0) throw new KilnryError('INVALID_INPUT', 'This run is not waiting for approval.');
  for (const step of waiting) {
    await db.db
      .update(runSteps)
      .set({
        status: 'completed',
        outputs: { choice: 'approve' },
        approvedAt: new Date(),
        decidedBy: 'owner',
      })
      .where(and(eq(runSteps.runId, runId), eq(runSteps.stepId, step.stepId)));
  }
  await db.db.update(runs).set({ status: 'running' }).where(eq(runs.id, runId));
  return driveResumed(db, engine, dataDir, runId);
}

/** Deny the waiting checkpoint; the run stops, completed outputs stay (F-WFL-04). */
export async function denyRun(db: DatabaseState, runId: string): Promise<RunState> {
  const rows = await db.db.select().from(runSteps).where(eq(runSteps.runId, runId));
  for (const step of rows) {
    if (step.status === 'waiting') {
      await db.db
        .update(runSteps)
        .set({ status: 'denied', outputs: { choice: 'deny' }, decidedBy: 'owner' })
        .where(and(eq(runSteps.runId, runId), eq(runSteps.stepId, step.stepId)));
    } else if (step.status === 'pending') {
      await db.db
        .update(runSteps)
        .set({ status: 'cancelled' })
        .where(and(eq(runSteps.runId, runId), eq(runSteps.stepId, step.stepId)));
    }
  }
  await db.db.update(runs).set({ status: 'cancelled', finishedAt: new Date() }).where(eq(runs.id, runId));
  const denied = await getRun(db, runId);
  return { status: 'cancelled', steps: [], spent_usd: denied.spent_usd };
}

/** Cancel a run: cancel every live job best-effort, mark pending steps cancelled. */
export async function cancelRun(db: DatabaseState, engine: JobEngine, runId: string): Promise<RunState> {
  const rows = await db.db.select().from(runSteps).where(eq(runSteps.runId, runId));
  for (const step of rows) {
    if (step.jobId && (step.status === 'running' || step.status === 'pending')) {
      try {
        await engine.cancelJob(step.jobId);
      } catch {
        // best effort: fal only cancels while queued, Higgsfield while queued.
      }
    }
    if (step.status === 'pending' || step.status === 'running' || step.status === 'waiting') {
      await db.db
        .update(runSteps)
        .set({ status: 'cancelled' })
        .where(and(eq(runSteps.runId, runId), eq(runSteps.stepId, step.stepId)));
    }
  }
  await db.db.update(runs).set({ status: 'cancelled', finishedAt: new Date() }).where(eq(runs.id, runId));
  const summary = await getRun(db, runId);
  return { status: 'cancelled', steps: [], spent_usd: summary.spent_usd };
}

/**
 * Retry a step (optionally swapping its model) and re-run from it (F-WFL-05):
 * reset that step and its dependants to pending in the rebuilt state, persist the
 * reset, and continue the run.
 */
export async function retryStep(
  db: DatabaseState,
  engine: JobEngine,
  dataDir: string,
  runId: string,
  stepId: string,
  modelOverride?: string,
): Promise<RunState> {
  const [runRow] = await db.db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!runRow) throw new KilnryError('NOT_FOUND', 'Run not found.');
  const entry = getWorkflow(dataDir, runRow.workflowId);
  if (!entry) throw new KilnryError('NOT_FOUND', `Workflow ${runRow.workflowId} is no longer installed.`);
  const persistedPlan = runRow.plan as unknown as Plan;
  const folder = runRow.folder ?? runFolder(entry.workflow, {});
  const baseScope = buildBaseScope(runId, folder, entry.workflow, persistedPlan);
  const rebuilt = await rebuildRunState(db, runId, entry.workflow, baseScope);
  resetFrom(rebuilt, stepId, modelOverride);
  // Persist the reset so the resumed drive sees the re-pended steps.
  for (const node of rebuilt.steps) {
    if (node.status === 'pending') {
      await db.db
        .update(runSteps)
        .set({
          status: 'pending',
          outputs: {},
          error: null,
          ...(node.model === undefined ? {} : { modelId: node.model }),
          adjustments: node.adjustments,
        })
        .where(and(eq(runSteps.runId, runId), eq(runSteps.stepId, node.step_id)));
    }
  }
  await db.db.update(runs).set({ status: 'running' }).where(eq(runs.id, runId));
  return driveResumed(db, engine, dataDir, runId);
}

interface RunContext {
  runId: string;
  plan: Plan;
  workflow: WorkflowFile;
  folder: string;
  startedAt: string;
  libraryRoot: string;
}

// The executor's effects, bound to the engine and the database. runStep is where
// the money path lives: a spending step is a createJob call, never an adapter.
function runEffects(db: DatabaseState, engine: JobEngine, run: RunContext): Effects {
  return {
    decide: async (node: RunStep): Promise<'approve' | 'deny' | 'wait'> => {
      // Record the checkpoint as waiting and pause; the approve/deny route
      // resumes the run once the owner answers.
      await upsertStep(db, run.runId, node, 'waiting');
      return 'wait';
    },
    persist: async (state: RunState): Promise<void> => {
      for (const node of state.steps) await upsertStep(db, run.runId, node, node.status);
    },
    runStep: async (node: RunStep, rendered: Step, scope: Scope): Promise<StepResult> => {
      if (node.kind === 'generate' || node.kind === 'transform' || node.kind === 'analyze') {
        return spendThroughEngine(db, engine, run, node, rendered, scope);
      }
      // set / assemble / export run inline with no provider and no spend.
      return { outputs: node.outputs, actual_usd: 0, status: 'completed' };
    },
  };
}

// One spending step → one createJob → estimate/confirm/reserve/ledger, tagged
// with source 'workflow', the run and step id, and the plan step's estimate as
// the confirmed cost. generate, transform and analyze all take this one road;
// the executor never touches an adapter (TRD-12 §6).
async function spendThroughEngine(
  db: DatabaseState,
  engine: JobEngine,
  run: RunContext,
  node: RunStep,
  rendered: Step,
  scope: Scope,
): Promise<StepResult> {
  const planStep = run.plan.steps.find((step) => step.step_id === node.step_id);
  const confirmedCost = planStep?.estimate_usd ?? 0;
  const jobInput = buildSpendInput(run.runId, run.folder, node, rendered, scope, confirmedCost);
  const created = await engine.createJob(jobInput);
  await db.db
    .update(runSteps)
    .set({
      status: 'running',
      jobId: created.job_id,
      modelId: created.route.model,
      provider: created.route.provider,
    })
    .where(and(eq(runSteps.runId, run.runId), eq(runSteps.stepId, node.step_id)));

  // Wait for the job's terminal state, bounded by the engine's own poll window
  // rather than a fixed two minutes, so a real video or lip-sync step that
  // outlasts two minutes is not cut off (waitForJob returns the instant the job
  // is terminal, so this never slows a fast step).
  const terminal = await engine.waitForJob(created.job_id, engine.pollWindowMs);
  const assetIds = await jobAssetIds(db, created.job_id);
  const actual = Number(terminal.actualUsd ?? terminal.estimateUsd ?? confirmedCost) || confirmedCost;
  if (terminal.status === 'completed') {
    return {
      outputs: {
        asset: assetIds[0] ?? '',
        assets: assetIds,
        job: created.job_id,
        // The step's own `outputs` templates (e.g. transcript, words) are
        // evaluated by the executor against `result`; expose the produced asset
        // ids under `result.assets` and `result.asset_id` so a transform's
        // transcript output and an assemble reading it resolve to a real file.
        result: { assets: assetIds, asset_id: assetIds[0] ?? '' },
      },
      actual_usd: actual,
      model: created.route.model,
      provider: created.route.provider,
      status: 'completed',
    };
  }
  return {
    outputs: {},
    actual_usd: terminal.status === 'moderated' ? 0 : actual,
    status: terminal.status === 'moderated' ? 'moderated' : 'failed',
    error: terminal.status,
    retryable: terminal.status === 'failed',
  };
}

async function jobAssetIds(db: DatabaseState, jobId: string): Promise<string[]> {
  const rows = await db.db.select({ id: assets.id }).from(assets).where(eq(assets.jobId, jobId));
  return rows.map((row) => row.id);
}

// Write one run_steps row from a RunStep node.
async function upsertStep(db: DatabaseState, runId: string, node: RunStep, status: string): Promise<void> {
  const existing = await db.db
    .select({ stepId: runSteps.stepId })
    .from(runSteps)
    .where(and(eq(runSteps.runId, runId), eq(runSteps.stepId, node.step_id)))
    .limit(1);
  const values = {
    status,
    name: node.step.name ?? node.step_id,
    kind: node.kind,
    approvalRequired: node.kind === 'approval' || node.approval !== false,
    actualUsd: node.actual_usd.toFixed(6),
    outputs: node.outputs,
    adjustments: node.adjustments,
    ...(node.model === undefined ? {} : { modelId: node.model }),
    ...(node.provider === undefined ? {} : { provider: node.provider }),
    ...(node.error === undefined ? {} : { error: node.error }),
    attempts: node.attempts,
  };
  if (existing[0]) {
    await db.db
      .update(runSteps)
      .set(values)
      .where(and(eq(runSteps.runId, runId), eq(runSteps.stepId, node.step_id)));
  } else {
    await db.db.insert(runSteps).values({ runId, stepId: node.step_id, ...values });
  }
}

// Persist the run's terminal state and rewrite run.kilnry.json atomically.
async function persistRun(
  db: DatabaseState,
  engine: JobEngine,
  runId: string,
  workflow: WorkflowFile,
  runPlan: Plan,
  state: RunState,
  folder: string,
  startedAt: string,
  libraryRoot: string | undefined,
): Promise<void> {
  const spent = state.spent_usd.toFixed(6);
  const finished = ['completed', 'failed', 'cancelled'].includes(state.status);
  await db.db
    .update(runs)
    .set({ status: state.status, spentUsd: spent, ...(finished ? { finishedAt: new Date() } : {}) })
    .where(eq(runs.id, runId));

  if (libraryRoot && libraryRoot !== '') {
    const manifest = buildManifest({
      runId,
      workflow,
      plan: runPlan,
      state,
      folder,
      startedAt,
      ...(finished ? { finishedAt: new Date().toISOString() } : {}),
    });
    try {
      const dir = join(libraryRoot, folder);
      mkdirSync(dir, { recursive: true });
      const target = join(dir, 'run.kilnry.json');
      const tmp = `${target}.tmp`;
      writeFileSync(tmp, JSON.stringify(manifest, null, 2), 'utf8');
      renameSync(tmp, target);
    } catch {
      // A manifest write failure does not fail the run; the database row is the
      // authoritative record and a reindex can rebuild the manifest.
    }
  }
}

// ── reads and actions ──────────────────────────────────────────────────────

export async function getRun(
  db: DatabaseState,
  runId: string,
): Promise<{
  id: string;
  workflow_id: string;
  status: string;
  folder: string | null;
  estimate_usd: number;
  spent_usd: number;
  steps: Array<{
    step_id: string;
    name: string;
    kind: string;
    status: string;
    model: string | null;
    estimate_usd: number | null;
    actual_usd: number | null;
  }>;
}> {
  const [run] = await db.db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) throw new KilnryError('NOT_FOUND', 'Run not found.');
  const steps = await db.db.select().from(runSteps).where(eq(runSteps.runId, runId));
  return {
    id: run.id,
    workflow_id: run.workflowId,
    status: run.status,
    folder: run.folder,
    estimate_usd: Number(run.estimateUsd ?? 0),
    spent_usd: Number(run.spentUsd ?? 0),
    steps: steps
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((step) => ({
        step_id: step.stepId,
        name: step.name ?? step.stepId,
        kind: step.kind ?? '',
        status: step.status ?? 'pending',
        model: step.modelId ?? null,
        estimate_usd: step.estimateUsd === null ? null : Number(step.estimateUsd),
        actual_usd: step.actualUsd === null ? null : Number(step.actualUsd),
      })),
  };
}

export async function listRuns(
  db: DatabaseState,
): Promise<
  Array<{ id: string; workflow_id: string; status: string; spent_usd: number; created_at: string }>
> {
  const rows = await db.db.select().from(runs);
  return rows
    .filter((row) => row.source === 'workflow')
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((row) => ({
      id: row.id,
      workflow_id: row.workflowId,
      status: row.status,
      spent_usd: Number(row.spentUsd ?? 0),
      created_at: row.createdAt.toISOString(),
    }));
}

/** Validate an imported workflow through the same validator as the CLI. */
export function importWorkflow(
  dataDir: string,
  yaml: string,
  fileName?: string,
): {
  ok: boolean;
  id?: string;
  issues: ReturnType<typeof validateWorkflowFile>['issues'];
} {
  const result = validateWorkflowFile(yaml, fileName);
  if (!result.ok || !result.workflow) return { ok: false, issues: result.issues };
  const dir = userCatalogueRoot(dataDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${result.workflow.id}.yaml`), yaml, 'utf8');
  return { ok: true, id: result.workflow.id, issues: result.issues };
}

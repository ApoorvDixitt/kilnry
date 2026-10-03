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

import {
  readFileSync,
  readdirSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  existsSync,
  copyFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import { KilnryError, loadConfig, loadRegistry, ulid, listCharacters, loadFullCharacter } from '@kilnry/core';
import { indexAsset, libraryMarker, resolveInRoot } from '@kilnry/core';
import {
  ffmpegExtension,
  isSupportedFfmpegOp,
  overlayText,
  probeMedia,
  runFfmpegOp,
  STILL_IMAGE,
} from '@kilnry/media';
import { burnCaptions } from '@kilnry/media';
import { splitRowSheet } from '@kilnry/media';
import { mkdir, readFile } from 'node:fs/promises';
import { CanonicalRequestSchema, type CanonicalRequest, type RouteConstraints } from '@kilnry/core';
import { analyzeTool, capabilityFor, type ToolServices } from '@kilnry/core';
import { assets, assetTags, assetLineage, jobs, runSteps, runs, type DatabaseState } from '@kilnry/db';
import {
  buildManifest,
  execute,
  expandRunState,
  packagesRootFrom,
  parseWorkflow,
  plan,
  renderStep,
  resetFrom,
  runFolder,
  validateWorkflowFile,
  withFileSource,
  type Effects,
  type ExpandedExportStep,
  type FileSourceRoots,
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
import { applyInputDefaults } from '@kilnry/workflows';

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
  dir: string;
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
        byId.set(workflow.id, { id: workflow.id, workflow, yaml, dir: root });
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

/** The file() roots a workflow may read from: packages/** and its own folder. */
function fileRootsFor(entry: CatalogueEntry): FileSourceRoots {
  return { packagesRoot: packagesRootFrom(entry.dir), workflowDir: entry.dir };
}

/**
 * A WorkflowRunner for the kilnry_workflows MCP tool (F-MCP-01), wrapping the
 * catalogue, planner and executor this module owns. plan never spends; run runs a
 * stored plan by its id and confirms the cost independently, so a stale plan is
 * allowed only there (F-WFL-02). Approve, deny, cancel and retry_step steer a run.
 */
export function workflowRunner(
  db: DatabaseState,
  engine: JobEngine,
  dataDir: string,
  analyze?: WorkflowAnalyzeServices,
): import('@kilnry/core').WorkflowRunner {
  const steer = analyze ? { analyze } : {};
  return {
    async list() {
      const catalogue = loadCatalogue(dataDir);
      return [...catalogue.values()].map((entry) => ({
        id: entry.workflow.id,
        name: entry.workflow.name,
        category: entry.workflow.category,
        description: entry.workflow.description ?? '',
        requires: entry.workflow.requires,
      }));
    },
    async get(workflowId) {
      const entry = getWorkflow(dataDir, workflowId);
      return entry ? { id: entry.workflow.id, ...(entry.workflow as Record<string, unknown>) } : undefined;
    },
    async plan(workflowId, inputs) {
      const { run_id, plan } = await planWorkflow(db, engine, dataDir, workflowId, inputs);
      return { run_id, plan };
    },
    async run(planRunId, confirmCostUsd) {
      const state = await startRun(db, engine, dataDir, planRunId, confirmCostUsd, {
        ...steer,
        // The MCP client confirmed the cost in this call, apart from planning, so
        // a stale plan may still run at ≥90% of its estimate (F-WFL-02).
        costConfirmedIndependently: true,
      });
      return { run_id: planRunId, status: state.status, spent_usd: state.spent_usd };
    },
    async status(runId) {
      return (await getRun(db, runId)) as unknown as Record<string, unknown>;
    },
    async approve(runId) {
      const state = await approveRun(db, engine, dataDir, runId, steer.analyze);
      return { run_id: runId, status: state.status, spent_usd: state.spent_usd };
    },
    async deny(runId) {
      const state = await denyRun(db, runId);
      return { run_id: runId, status: state.status, spent_usd: state.spent_usd };
    },
    async cancel(runId) {
      const state = await cancelRun(db, engine, runId);
      return { run_id: runId, status: state.status, spent_usd: state.spent_usd };
    },
    async retryStep(runId, stepId, model) {
      const state = await retryStep(db, engine, dataDir, runId, stepId, model, steer.analyze);
      return { run_id: runId, status: state.status, spent_usd: state.spent_usd };
    },
    async listRuns() {
      return (await listRuns(db)) as unknown as Array<Record<string, unknown>>;
    },
  };
}

/**
 * A synchronous character resolver for the plan and run scope, backed by a map
 * of every character loaded once. The planner and executor read
 * `characters[@handle]` synchronously through a Proxy, so a workflow that reads a
 * Character — the character sheet reads its anchor, appearance and descriptor —
 * needs the resolved character present. Without it those reads returned an empty
 * object and the plan threw on `.references | filter(...)` (F-WFL-06). This is the
 * same full character the composer and Chat resolve a mention to.
 */
async function characterResolver(db: DatabaseState): Promise<(handle: string) => unknown> {
  const heads = await listCharacters(db);
  const byHandle = new Map<string, unknown>();
  for (const head of heads) {
    try {
      byHandle.set(head.handle.toLowerCase(), await loadFullCharacter(db, head.handle));
    } catch {
      // A character that fails to load is simply absent from the resolver.
    }
  }
  return (handle: string) => byHandle.get(handle.replace(/^@/, '').toLowerCase()) ?? {};
}

// ── planning ─────────────────────────────────────────────────────────────────

// The input field names whose x-kilnry widget is "character", so a plan can
// check the handle resolves before the templates read it.
function characterInputFields(workflow: WorkflowFile): string[] {
  const schema = workflow.inputs as
    { properties?: Record<string, { 'x-kilnry'?: { widget?: string } }> } | undefined;
  const properties = schema?.properties ?? {};
  return Object.entries(properties)
    .filter(([, property]) => property['x-kilnry']?.widget === 'character')
    .map(([name]) => name);
}

/**
 * Build a PlanContext bound to the engine: priceStep routes and estimates a
 * spending step through engine.estimate (which never spends), so the plan uses
 * the same prices as an actual run.
 */
function planContext(
  fileRoots?: FileSourceRoots,
  resolveCharacter?: (handle: string) => unknown,
): PlanContext {
  return {
    // Inputs default and validate against the workflow's JSON Schema. A full
    // JSON-Schema validation is layered in the drawer; here defaults are applied
    // and required inputs are trusted (the route validates the payload shape).
    resolveInputs: (workflow, inputs) => applyInputDefaults(workflow, inputs),
    // The synchronous planner only expands the graph; pricePlan then estimates
    // each spending leaf through the engine for the real total.
    priceStep: () => ({ estimate_usd: 0, eta_s: 0, why: 'priced at run' }),
    ...(fileRoots ? { fileRoots } : {}),
    ...(resolveCharacter ? { resolveCharacter } : {}),
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

  // A workflow that reads characters[inputs.<field>] cannot plan if that handle
  // names no Character: the template reads undefined and throws deep in the
  // planner. Resolve each character-typed input up front and refuse with a clear
  // message instead (F-WFL-06).
  const resolveChar = await characterResolver(db);
  for (const field of characterInputFields(entry.workflow)) {
    const handle = inputs[field];
    if (typeof handle === 'string' && handle !== '') {
      const resolved = resolveChar(handle) as { handle?: unknown };
      if (!resolved || resolved.handle === undefined) {
        throw new KilnryError(
          'INVALID_INPUT',
          `No Character @${handle.replace(/^@/, '')} is in the Library.`,
        );
      }
    }
  }

  const ctx = planContext(fileRootsFor(entry), resolveChar);
  // Price each spending leaf through the engine estimate for the real total.
  const priced = await pricePlan(engine, entry.workflow, inputs, ctx);
  const runId = ulid();
  // Give the plan its own stable id, distinct from the run id, so the manifest
  // and the MCP run-by-plan path reference the plan rather than the run (F-WFL-09).
  priced.id = `plan_${ulid()}`;
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
      // Price against a lenient scope: the estimate depends on the capability,
      // model, resolution and reference count, not on the prompt text, so bind
      // empty stand-ins for the runtime-only namespaces (`steps`, the foreach
      // index `k`) a leaf inside a loop references, so rendering them does not
      // throw before the routing fields are read.
      const scope = {
        inputs: base.inputs,
        defaults: workflow.defaults,
        vars: base.vars,
        steps: {},
        k: 0,
        result: {},
      } as unknown as Scope;
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

// Split a `provider:voice_id` voice param (what the voice widget and the tts
// workflows write) into the { provider, voice_id } object the canonical request
// wants. A value that is already an object passes through; an empty string, a
// bare handle, or a malformed value yields nothing so the request omits voice.
function parseVoiceParam(value: unknown): { provider: string; voice_id: string } | undefined {
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    if (typeof object.provider === 'string' && typeof object.voice_id === 'string') {
      return { provider: object.provider, voice_id: object.voice_id };
    }
    return undefined;
  }
  if (typeof value !== 'string' || value === '') return undefined;
  const separator = value.indexOf(':');
  if (separator <= 0 || separator === value.length - 1) return undefined;
  return { provider: value.slice(0, separator), voice_id: value.slice(separator + 1) };
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
    else if (key === 'voice') {
      // The voice widget and the workflows write `voice` as a `provider:voice_id`
      // string, but the canonical request wants { provider, voice_id }. Split it
      // so a workflow tts step (narrator, motion-design, localize) routes rather
      // than failing schema validation. An empty or malformed value is dropped.
      const parsed = parseVoiceParam(value);
      if (parsed) params.voice = parsed;
    } else if (CANONICAL_PARAM_KEYS.has(key)) params[key] = value;
    else extra[key] = value;
  }
  if (Object.keys(extra).length > 0) params.extra = extra;
  // Honour the step's explicit capability (reference2video, image_edit, …) and
  // the media kind it implies, rather than inferring from kind alone: a clip
  // step is reference2video with audio, not a plain image. The step's own
  // constraints (needs_audio, refs_count, duration, resolution) route it.
  const KIND_FOR_CAPABILITY: Record<string, 'image' | 'video' | 'audio' | '3d'> = {
    text2image: 'image',
    image_edit: 'image',
    text2video: 'video',
    image2video: 'video',
    reference2video: 'video',
    text2audio: 'audio',
    text2speech: 'audio',
    text2threed: '3d',
  };
  const capability = typeof generate.capability === 'string' ? generate.capability : undefined;
  const kind = capability
    ? (KIND_FOR_CAPABILITY[capability] ?? generate.kind_of ?? 'image')
    : (generate.kind_of ?? 'image');
  const stepConstraints =
    generate.constraints !== null && typeof generate.constraints === 'object'
      ? (generate.constraints as Record<string, unknown>)
      : {};
  const request = CanonicalRequestSchema.parse({
    kind,
    capability:
      capability ??
      capabilityFor(
        kind,
        medias.map((m) => ({ role: m.role as never })),
      ),
    prompt: String(generate.prompt || 'workflow step'),
    ...(generate.negative_prompt === undefined ? {} : { negative_prompt: String(generate.negative_prompt) }),
    model: typeof generate.model === 'string' && generate.model !== 'auto' ? generate.model : undefined,
    params,
    medias,
    injections: [],
    count: typeof generate.count === 'number' ? generate.count : 1,
    target_folder: 'inbox',
    source: 'workflow',
  }) as CanonicalForStep['request'];
  const refsCount = medias.filter((media) => ['reference', 'product'].includes(media.role)).length;
  const constraints: RouteConstraints = {
    refs_count: refsCount,
    ...(typeof generate.model === 'string' && generate.model !== 'auto'
      ? { pinned_model: generate.model }
      : {}),
    ...(typeof stepConstraints.needs_audio === 'boolean' ? { needs_audio: stepConstraints.needs_audio } : {}),
    ...(typeof stepConstraints.quality === 'string'
      ? { quality: stepConstraints.quality as 'draft' | 'standard' | 'premium' }
      : {}),
    ...(typeof stepConstraints.duration_s === 'number' ? { duration_s: stepConstraints.duration_s } : {}),
    ...(typeof params.duration_s === 'number' ? { duration_s: params.duration_s as number } : {}),
    ...(typeof stepConstraints.min_resolution === 'string'
      ? { min_resolution: stepConstraints.min_resolution as NonNullable<RouteConstraints['min_resolution']> }
      : {}),
    ...(typeof params.aspect_ratio === 'string' ? { aspect_ratio: params.aspect_ratio as string } : {}),
  };
  return { request, constraints };
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
    // The idempotency key carries the attempt number, so a retry after a failed
    // attempt is a fresh request rather than an idempotent replay of the failed
    // job (F-WFL-05). A crash-resume that re-runs the same attempt reuses the
    // same key and correctly replays the job already created for it.
    client_request_id: `${runId}:${node.instance_id}:${node.attempts}`,
  };
}

// ── running ──────────────────────────────────────────────────────────────────
/**
 * Assert a plan is fresh enough to run (TRD-10 §3.5). Past fifteen minutes the
 * plan is stale and must be re-planned. The web route always requires the
 * re-plan, because it supplies the confirmed cost in the same request as the run,
 * so a client that echoes the total could otherwise run an arbitrarily old plan.
 * Only the MCP path — where the cost is confirmed independently of the run call —
 * may run a stale plan when the confirmed cost still covers at least 90% of the
 * estimate (F-WFL-02).
 */
export function assertFreshPlan(
  persistedPlan: Plan,
  confirmCostUsd: number,
  now: Date,
  costConfirmedIndependently: boolean,
): void {
  const ageMs = now.getTime() - new Date(persistedPlan.created_at).getTime();
  const fresh = ageMs <= 15 * 60_000;
  if (fresh) return;
  const confirmedEnough =
    costConfirmedIndependently && confirmCostUsd >= 0.9 * persistedPlan.total_estimate_usd;
  if (!confirmedEnough) {
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
  options: {
    automatic?: boolean;
    skipApprovals?: boolean;
    targetFolder?: string;
    analyze?: WorkflowAnalyzeServices;
    // The MCP run path confirms the cost independently of the run call, so it may
    // run a plan up to the estimate's 90% even once stale; the web route, which
    // supplies the cost in the same request, never may (F-WFL-02).
    costConfirmedIndependently?: boolean;
  } = {},
): Promise<RunState> {
  const [run] = await db.db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) throw new KilnryError('NOT_FOUND', 'Run not found.');
  const persistedPlan = run.plan as unknown as Plan;
  assertFreshPlan(persistedPlan, confirmCostUsd, new Date(), options.costConfirmedIndependently ?? false);

  const entry = getWorkflow(dataDir, run.workflowId);
  if (!entry) throw new KilnryError('NOT_FOUND', `Workflow ${run.workflowId} is no longer installed.`);

  const config = await loadConfig();
  const project = options.targetFolder ?? (run.inputs as { folder?: string }).folder;
  const folder = run.folder ?? runFolder(entry.workflow, project === undefined ? {} : { project });
  const startedAt = run.createdAt.toISOString();
  await db.db.update(runs).set({ status: 'running', folder }).where(eq(runs.id, runId));

  const resolveChar = await characterResolver(db);
  const baseScope: Scope = withFileSource(
    {
      inputs: persistedPlan.inputs,
      defaults: entry.workflow.defaults,
      vars: persistedPlan.vars,
      run: { id: runId, folder, workflow: entry.workflow.id },
      characters: new Proxy({}, { get: (_t, handle: string) => resolveChar(String(handle)) }),
    },
    fileRootsFor(entry),
  );

  const effects = runEffects(db, engine, {
    runId,
    plan: persistedPlan,
    workflow: entry.workflow,
    folder,
    startedAt,
    libraryRoot: config.library_root ?? '',
    libraryId: config.library_root ? (await libraryMarker(config.library_root)).library_id : '',
    ...(options.analyze ? { analyze: options.analyze } : {}),
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
function buildBaseScope(
  runId: string,
  folder: string,
  entry: CatalogueEntry,
  persistedPlan: Plan,
  resolveChar: (handle: string) => unknown,
): Scope {
  return withFileSource(
    {
      inputs: persistedPlan.inputs,
      defaults: entry.workflow.defaults,
      vars: persistedPlan.vars,
      run: { id: runId, folder, workflow: entry.workflow.id },
      characters: new Proxy({}, { get: (_t, handle: string) => resolveChar(String(handle)) }),
    },
    fileRootsFor(entry),
  );
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
    // Restore the job id and rendered inputs the step ran with, so a run that
    // paused and resumed still names them in the manifest — the node graph is
    // rebuilt fresh on resume and would otherwise lose them (F-WFL-09).
    if (row.jobId) node.job_id = row.jobId;
    if (row.inputs) node.inputs = row.inputs;
    if (row.actualUsd) node.actual_usd = Number(row.actualUsd);
    if (Array.isArray(row.adjustments)) node.adjustments = row.adjustments as string[];
    node.attempts = row.attempts ?? 0;
    // A decided checkpoint carries its approval time. For a step that only had an
    // approval gate in front of its own work, that is what tells the run loop the
    // gate is cleared so the step runs instead of pausing again (F-WFL-04).
    if (row.approvedAt) node.approval_cleared = true;
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
  options: { automatic?: boolean; skipApprovals?: boolean; analyze?: WorkflowAnalyzeServices } = {},
): Promise<RunState> {
  const [run] = await db.db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) throw new KilnryError('NOT_FOUND', 'Run not found.');
  const entry = getWorkflow(dataDir, run.workflowId);
  if (!entry) throw new KilnryError('NOT_FOUND', `Workflow ${run.workflowId} is no longer installed.`);
  const persistedPlan = run.plan as unknown as Plan;
  const config = await loadConfig();
  const folder = run.folder ?? runFolder(entry.workflow, {});
  const startedAt = run.createdAt.toISOString();
  const baseScope = buildBaseScope(runId, folder, entry, persistedPlan, await characterResolver(db));
  const existing = await rebuildRunState(db, runId, entry.workflow, baseScope);
  const effects = runEffects(db, engine, {
    runId,
    plan: persistedPlan,
    workflow: entry.workflow,
    folder,
    startedAt,
    libraryRoot: config.library_root ?? '',
    libraryId: config.library_root ? (await libraryMarker(config.library_root)).library_id : '',
    ...(options.analyze ? { analyze: options.analyze } : {}),
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
  analyze?: WorkflowAnalyzeServices,
): Promise<RunState> {
  const waiting = await db.db
    .select()
    .from(runSteps)
    .where(and(eq(runSteps.runId, runId), eq(runSteps.status, 'waiting')));
  if (waiting.length === 0) throw new KilnryError('INVALID_INPUT', 'This run is not waiting for approval.');
  for (const step of waiting) {
    // A barrier step (`kind: approval`) is finished the moment it is approved. A
    // step that merely carried an approval gate in front of its own work goes back
    // to pending with its approval time recorded, so the resumed run clears the
    // gate and then runs the step (F-WFL-04, PRD-10 §4).
    const barrier = step.kind === 'approval';
    await db.db
      .update(runSteps)
      .set({
        status: barrier ? 'completed' : 'pending',
        ...(barrier ? { outputs: { choice: 'approve' } } : {}),
        approvedAt: new Date(),
        decidedBy: 'owner',
      })
      .where(and(eq(runSteps.runId, runId), eq(runSteps.stepId, step.stepId)));
  }
  await db.db.update(runs).set({ status: 'running' }).where(eq(runs.id, runId));
  return driveResumed(db, engine, dataDir, runId, analyze ? { analyze } : {});
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
 * Assert a swapped model can serve a step's capability. A model chosen by name
 * must be in the registry and list the capability the step needs; otherwise the
 * swap is refused before the run continues (F-WFL-05). Kept pure and exported so
 * the rule is tested directly without standing up a database and engine.
 */
export function assertModelServes(
  model: string,
  capability: string,
  models: ReadonlyArray<{ provider: string; model_id: string; capabilities: readonly string[] }>,
  stepId: string,
): void {
  const matches = models.filter(
    (entry) => entry.model_id === model || `${entry.provider}/${entry.model_id}` === model,
  );
  if (matches.length === 0) {
    throw new KilnryError('NOT_FOUND', `Model ${model} is not in the registry.`);
  }
  if (!matches.some((entry) => entry.capabilities.includes(capability))) {
    throw new KilnryError(
      'INVALID_INPUT',
      `Model ${model} does not support ${capability}, which step "${stepId}" needs.`,
    );
  }
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
  analyze?: WorkflowAnalyzeServices,
): Promise<RunState> {
  const [runRow] = await db.db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!runRow) throw new KilnryError('NOT_FOUND', 'Run not found.');
  const entry = getWorkflow(dataDir, runRow.workflowId);
  if (!entry) throw new KilnryError('NOT_FOUND', `Workflow ${runRow.workflowId} is no longer installed.`);
  const persistedPlan = runRow.plan as unknown as Plan;
  const folder = runRow.folder ?? runFolder(entry.workflow, {});
  const baseScope = buildBaseScope(runId, folder, entry, persistedPlan, await characterResolver(db));
  const rebuilt = await rebuildRunState(db, runId, entry.workflow, baseScope);
  // A model swap validates before it re-runs: the chosen model must be in the
  // registry and serve the step's own capability, so an image model pinned on a
  // video step is refused now rather than dispatched as a mismatched job
  // (F-WFL-05). This is checked against the step's capability specifically, not
  // through the general router, whose pin-by-name is an explicit override for a
  // directly requested generation.
  if (modelOverride !== undefined) {
    const target = rebuilt.steps.find((node) => node.step_id === stepId);
    if (target && (target.kind === 'generate' || target.kind === 'transform' || target.kind === 'analyze')) {
      const rendered = renderStep(target.step, baseScope) as Step;
      const capability = canonicalRequestForStep(rendered, baseScope).request.capability;
      const registry = await loadRegistry(db);
      assertModelServes(modelOverride, capability, registry.models, stepId);
    }
  }
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
  return driveResumed(db, engine, dataDir, runId, analyze ? { analyze } : {});
}

/**
 * Re-run from a step as a new child run (F-WFL-05 / F31, PRD-10 section 5):
 * create a new run that copies the parent's workflow, inputs and plan, reuses
 * the outputs of every step before the chosen one at no cost, re-executes the
 * chosen step and everything after it, records parent_run_id, and writes into a
 * sibling folder with a _rerun suffix. The upstream steps are never re-billed.
 */
export async function rerunFromStep(
  db: DatabaseState,
  engine: JobEngine,
  dataDir: string,
  runId: string,
  stepId: string,
  analyze?: WorkflowAnalyzeServices,
): Promise<{ run_id: string; parent_run_id: string; folder: string }> {
  const [parent] = await db.db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!parent) throw new KilnryError('NOT_FOUND', 'Run not found.');
  const entry = getWorkflow(dataDir, parent.workflowId);
  if (!entry) throw new KilnryError('NOT_FOUND', `Workflow ${parent.workflowId} is no longer installed.`);

  const parentSteps = await db.db.select().from(runSteps).where(eq(runSteps.runId, runId));
  const pivot = parentSteps.find((row) => row.stepId === stepId);
  if (!pivot) throw new KilnryError('NOT_FOUND', `Step ${stepId} is not part of this run.`);
  const pivotPosition = pivot.position ?? 0;

  // Count the existing re-runs of this chain so the folder suffix increments:
  // the first re-run is _rerun2, the next _rerun3, matching PRD-10 section 5.
  const rootId = parent.parentRunId ?? parent.id;
  const siblings = await db.db.select({ id: runs.id }).from(runs).where(eq(runs.parentRunId, rootId));
  const rerunOrdinal = siblings.length + 2;

  const project = (parent.inputs as { folder?: string }).folder;
  const folder = runFolder(entry.workflow, {
    ...(project === undefined ? {} : { project }),
    rerun: rerunOrdinal,
  });

  const childId = ulid();
  await db.db.insert(runs).values({
    id: childId,
    workflowId: parent.workflowId,
    workflowVersion: parent.workflowVersion,
    status: 'running',
    inputs: parent.inputs,
    plan: parent.plan,
    folder,
    estimateUsd: parent.estimateUsd,
    source: 'workflow',
    parentRunId: rootId,
  });

  // Seed the child's steps: every step before the pivot is reused from the
  // parent as a completed step at zero cost (its output already exists on disk),
  // so the re-run never re-bills the work it keeps. The pivot and later steps are
  // left unseeded so the executor treats them as pending and runs them.
  const reused = parentSteps.filter((row) => {
    const position = row.position ?? 0;
    return position < pivotPosition && row.status === 'completed';
  });
  for (const row of reused) {
    await db.db.insert(runSteps).values({
      runId: childId,
      stepId: row.stepId,
      position: row.position,
      name: row.name,
      kind: row.kind,
      status: 'completed',
      jobId: row.jobId,
      modelId: row.modelId,
      provider: row.provider,
      estimateUsd: row.estimateUsd,
      // Reused output: zero actual cost on the child so the re-run total counts
      // only the steps it re-executes.
      actualUsd: '0',
      inputs: row.inputs,
      outputs: row.outputs,
      logs: row.logs,
      attempts: row.attempts,
      adjustments: row.adjustments,
    });
  }

  await driveResumed(db, engine, dataDir, childId, analyze ? { analyze } : {});
  return { run_id: childId, parent_run_id: rootId, folder };
}

export interface RunContext {
  runId: string;
  plan: Plan;
  workflow: WorkflowFile;
  folder: string;
  startedAt: string;
  libraryRoot: string;
  // The Library id, so an assembled output is indexed with the same sidecar and
  // thumbnail path a dropped file gets (TRD-12 §6, F-WFL-06).
  libraryId: string;
  // What an analyze step needs to run through the metered analyze tool: an
  // OpenRouter key and a way to turn an asset id into a loopback media URL.
  // Absent means analyze steps cannot run (no key configured).
  analyze?: WorkflowAnalyzeServices;
}

/** The services a workflow analyze step needs, supplied by the calling route. */
export interface WorkflowAnalyzeServices {
  openrouterKey?: string;
  assetUrl: (assetId: string) => string;
  autoApproveBelowUsd?: number;
}

// Build the analyze services a run needs from a resolved OpenRouter key and the
// running port, so the run, approve and retry routes wire analyze steps the same
// way. Analyze steps auto-approve within the run because the plan total was
// already confirmed at Approve (F-WFL-02); the ledger row is still written.
export function buildAnalyzeServices(
  openrouterKey: string | undefined,
  port: number,
): WorkflowAnalyzeServices {
  return {
    ...(openrouterKey ? { openrouterKey } : {}),
    assetUrl: (assetId: string) => `http://127.0.0.1:${port}/api/media/${assetId}`,
    autoApproveBelowUsd: Number.POSITIVE_INFINITY,
  };
}

// The executor's effects, bound to the engine and the database. runStep is where
// the money path lives: a generate or transform step is a createJob call, an
// analyze step is a metered analyze-tool call, never an adapter. Exported so a
// host test can drive the real assemble/export handlers against an in-memory
// database and prove outputs.final resolves for an assemble- or export-final
// workflow (F-WFL-09).
export function runEffects(db: DatabaseState, engine: JobEngine, run: RunContext): Effects {
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
    runStep: async (
      node: RunStep,
      rendered: Step | ExpandedExportStep,
      scope: Scope,
    ): Promise<StepResult> => {
      if (node.kind === 'analyze') {
        return analyzeThroughTool(db, engine, run, node, rendered as Extract<Step, { kind: 'analyze' }>);
      }
      if (node.kind === 'generate' || node.kind === 'transform') {
        return spendThroughEngine(db, engine, run, node, rendered as Step, scope);
      }
      if (node.kind === 'export') {
        return exportFiles(db, run, rendered as ExpandedExportStep);
      }
      if (node.kind === 'assemble') {
        return assembleFile(db, run, node, rendered as Step);
      }
      // set steps are evaluated by the executor itself (TRD-12 §6) and approval
      // barriers never reach the host; any other kind here is a host gap.
      throw new KilnryError('INVALID_INPUT', `The workflow host cannot run a ${node.kind} step.`);
    },
  };
}

// Run an analyze step through the metered kilnry_analyze tool (F-WFL-06). With
// references it is a vision-language-model task; without them a text-only
// large-language-model call. The tool prices, confirms against the plan step's
// estimate, reserves the budget, writes one spend-ledger row and one audit
// event, and returns the text and — when a schema or a scored task asks for it —
// a structured object with a score and a badge. The step's outputs expose these
// under result.{text,structured,score,badge} so a later branch can read them.
async function analyzeThroughTool(
  db: DatabaseState,
  engine: JobEngine,
  run: RunContext,
  node: RunStep,
  rendered: Extract<Step, { kind: 'analyze' }>,
): Promise<StepResult> {
  const planStep = run.plan.steps.find((step) => step.step_id === node.step_id);
  const confirmedCost = planStep?.estimate_usd ?? 0;
  const analyze = run.analyze;
  if (!analyze || !analyze.openrouterKey) {
    return {
      outputs: {},
      actual_usd: 0,
      status: 'failed',
      error: 'no_openrouter_key',
      retryable: false,
    };
  }
  const refs = Array.isArray(rendered.refs)
    ? (rendered.refs as unknown[]).map(String).filter((id) => id !== '')
    : [];
  const services: ToolServices = {
    db,
    scope: 'full',
    engine,
    openrouterKey: analyze.openrouterKey,
    assetUrl: analyze.assetUrl,
    autoApproveBelowUsd: analyze.autoApproveBelowUsd ?? Number.POSITIVE_INFINITY,
    confirmedBy: () => 'user',
  };
  const result = await analyzeTool.execute(
    {
      task: rendered.task,
      refs,
      ...(typeof rendered.instructions === 'string' ? { instructions: rendered.instructions } : {}),
      ...(rendered.schema === undefined ? {} : { schema: rendered.schema }),
      ...(rendered.model && rendered.model !== 'auto' ? { model: rendered.model } : {}),
      confirm_cost_usd: confirmedCost,
      folder: run.folder,
      run_id: run.runId,
      step_id: node.step_id,
    },
    services,
  );
  const structured = result.structuredContent as {
    error?: { code?: string };
    text?: string;
    model?: string;
    structured?: unknown;
    score?: number;
    badge?: string;
    actual_usd?: number;
  };
  if (structured.error) {
    return {
      outputs: {},
      actual_usd: 0,
      status: 'failed',
      error: structured.error.code ?? 'analyze_failed',
      retryable: false,
    };
  }
  const actual = typeof structured.actual_usd === 'number' ? structured.actual_usd : confirmedCost;
  // Expose the analysis under `result` so the step's own outputs templates and a
  // later branch's `when` can read result.structured, result.text, result.score.
  const resultNamespace: Record<string, unknown> = {
    text: structured.text ?? '',
    ...(structured.structured === undefined ? {} : { structured: structured.structured }),
    ...(structured.score === undefined ? {} : { score: structured.score }),
    ...(structured.badge === undefined ? {} : { badge: structured.badge }),
  };
  return {
    outputs: { result: resultNamespace },
    actual_usd: actual,
    ...(structured.model === undefined ? {} : { model: structured.model }),
    provider: 'openrouter',
    status: 'completed',
  };
}

// An assemble step: a free, local FFmpeg operation (concat, mux_audio, overlay,
// probe…) that produces a new file in the run folder. It spends nothing, but it
// does yield an asset — so it must record the id and path of the file it
// produced, or a workflow whose `outputs.final` is an assemble step (a concat to
// a master cut, a burn to captions) would resolve to nothing on disk (F-WFL-09).
// A `probe` reads a source and adds no file, so it carries its inputs' first
// asset through rather than minting a new one.
async function assembleFile(
  db: DatabaseState,
  run: RunContext,
  node: RunStep,
  rendered: Step,
): Promise<StepResult> {
  const step = rendered as Extract<Step, { kind: 'assemble' }>;
  const inputs = Array.isArray(step.inputs)
    ? (step.inputs as unknown[]).map(String).filter((id) => id !== '')
    : [];
  const op = String(step.op ?? '');
  const params = (step.params ?? {}) as Record<string, unknown>;
  const root = run.libraryRoot;

  // Resolve an input ref — an asset id, a Library-relative path, or an https URL
  // — to an absolute path ffmpeg can read.
  const resolveInput = async (ref: string): Promise<string> => {
    if (/^https?:\/\//.test(ref)) return ref;
    if (ref.startsWith('/')) return (await resolveInRoot(root, ref, { mustExist: true })).abs;
    const [row] = await db.db.select({ path: assets.path }).from(assets).where(eq(assets.id, ref)).limit(1);
    if (!row) throw new KilnryError('NOT_FOUND', `Assemble input ${ref} is not in the Library.`);
    return (await resolveInRoot(root, row.path, { mustExist: true })).abs;
  };

  // A probe measures its source and mints no file. It passes the input through
  // so a later `steps.probe.outputs.asset` resolves, and exposes the real
  // duration (TRD-09 §3.1) so a narrated workflow can time cuts from it.
  if (op === 'probe' || op === 'metadata') {
    const source = inputs[0] ?? '';
    let durationS = 0;
    if (source !== '' && root !== '') {
      const probe = await probeMedia(await resolveInput(source));
      durationS = probe.duration_s ?? 0;
    }
    return {
      outputs: {
        result: { asset_id: source, assets: source === '' ? [] : [source], duration_s: durationS },
        asset: source,
        duration_s: durationS,
      },
      actual_usd: 0,
      status: 'completed',
    };
  }

  const outputName =
    typeof step.output_name === 'string' && step.output_name !== ''
      ? step.output_name
      : `${node.step_id}${ffmpegExtension(op)}`;
  const targetRelative = join(run.folder, outputName);

  // split_grid cuts a turnaround sheet into one asset per column with sharp
  // (an internal assembly op, §6.3); each panel is indexed like a dropped file.
  if (op === 'split_grid' && root !== '' && inputs.length > 0) {
    const sourceAbs = await resolveInput(inputs[0]!);
    const columns = typeof params.columns === 'number' ? params.columns : Number(params.columns) || 1;
    const targets = await Promise.all(
      Array.from({ length: Math.max(1, columns) }, (_, index) =>
        resolveInRoot(root, join(run.folder, `${node.step_id}_${index + 1}.png`), { mustExist: false }),
      ),
    );
    await mkdir(dirname(targets[0]!.abs), { recursive: true });
    try {
      await splitRowSheet(
        sourceAbs,
        targets.map((target) => target.abs),
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return { outputs: {}, actual_usd: 0, status: 'failed', error: `split_grid failed: ${detail}` };
    }
    const assetIds: string[] = [];
    for (let index = 0; index < targets.length; index += 1) {
      const relative = join(run.folder, `${node.step_id}_${index + 1}.png`);
      const indexed = await indexAsset(db, root, relative, run.libraryId);
      const assetId = indexed.sidecar.asset_id;
      await db.db
        .insert(assetLineage)
        .values({ childId: assetId, parentId: inputs[0]!, role: op })
        .onConflictDoNothing();
      await db.db
        .update(assets)
        .set({ runId: run.runId, stepId: node.step_id, source: 'assemble' })
        .where(eq(assets.id, assetId));
      assetIds.push(assetId);
    }
    return {
      outputs: {
        result: { asset_id: assetIds[0] ?? '', assets: assetIds },
        asset: assetIds[0] ?? '',
        assets: assetIds,
      },
      actual_usd: 0,
      status: 'completed',
    };
  }

  // burn_captions renders a transcript into subtitles and burns them with
  // libass (TRD-09 §3.6). The transcript asset's JSON is read from disk; the
  // video is the step's input. Output is an .mp4.
  if (op === 'burn_captions' && root !== '' && inputs.length > 0) {
    const videoAbs = await resolveInput(inputs[0]!);
    const transcriptRef = typeof params.transcript === 'string' ? params.transcript : '';
    const outputAbs = (await resolveInRoot(root, targetRelative, { mustExist: false })).abs;
    await mkdir(dirname(outputAbs), { recursive: true });
    try {
      const transcriptAbs = await resolveInput(transcriptRef);
      const transcript = JSON.parse(await readFile(transcriptAbs, 'utf8')) as unknown;
      await burnCaptions(videoAbs, transcript, outputAbs, {
        ...(typeof params.look === 'string' ? { look: params.look as never } : {}),
        ...(typeof params.safe_zone === 'string' ? { safeZone: params.safe_zone as never } : {}),
        ...(typeof params.max_words === 'number' ? { maxWords: params.max_words } : {}),
        ...(typeof params.max_chars === 'number' ? { maxChars: params.max_chars } : {}),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return { outputs: {}, actual_usd: 0, status: 'failed', error: `burn_captions failed: ${detail}` };
    }
    const indexed = await indexAsset(db, root, targetRelative, run.libraryId);
    const assetId = indexed.sidecar.asset_id;
    await db.db
      .insert(assetLineage)
      .values({ childId: assetId, parentId: inputs[0]!, role: op })
      .onConflictDoNothing();
    await db.db
      .update(assets)
      .set({ runId: run.runId, stepId: node.step_id, source: 'assemble' })
      .where(eq(assets.id, assetId));
    return {
      outputs: {
        result: { asset_id: assetId, assets: [assetId] },
        asset: assetId,
        assets: [assetId],
        path: targetRelative,
      },
      actual_usd: 0,
      status: 'completed',
    };
  }

  // overlay_text draws a headline onto an image with sharp (no ffmpeg drawtext,
  // TRD-09 §2): render it, then index the PNG like any assembled output.
  if (op === 'overlay_text' && root !== '' && inputs.length > 0) {
    const sourceAbs = await resolveInput(inputs[0]!);
    const outputAbs = (await resolveInRoot(root, targetRelative, { mustExist: false })).abs;
    await mkdir(dirname(outputAbs), { recursive: true });
    try {
      await overlayText(sourceAbs, outputAbs, {
        text: String(params.text ?? ''),
        ...(typeof params.position === 'string' ? { position: params.position } : {}),
        ...(typeof params.stroke === 'boolean' ? { stroke: params.stroke } : {}),
        ...(typeof params.font === 'string' ? { font: params.font } : {}),
        ...(typeof params.color === 'string' ? { color: params.color } : {}),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return { outputs: {}, actual_usd: 0, status: 'failed', error: `overlay_text failed: ${detail}` };
    }
    const indexed = await indexAsset(db, root, targetRelative, run.libraryId);
    const assetId = indexed.sidecar.asset_id;
    await db.db
      .insert(assetLineage)
      .values({ childId: assetId, parentId: inputs[0]!, role: op })
      .onConflictDoNothing();
    await db.db
      .update(assets)
      .set({ runId: run.runId, stepId: node.step_id, source: 'assemble' })
      .where(eq(assets.id, assetId));
    return {
      outputs: {
        result: { asset_id: assetId, assets: [assetId] },
        asset: assetId,
        assets: [assetId],
        path: targetRelative,
      },
      actual_usd: 0,
      status: 'completed',
    };
  }

  // Render the output for real through the same local ffmpeg path kilnry_ffmpeg
  // uses (TRD-12 §6: assemble → kilnry_ffmpeg.execute, in-process, no provider),
  // then index the file so it carries a sidecar and lineage like any asset. A
  // run with no Library root is the unit-test stub below.
  if (root !== '' && isSupportedFfmpegOp(op) && inputs.length > 0) {
    const resolved = await Promise.all(inputs.map(resolveInput));
    const outputAbs = (await resolveInRoot(root, targetRelative, { mustExist: false })).abs;
    await mkdir(dirname(outputAbs), { recursive: true });
    // Concat needs each input's audio flag and duration so a still or a silent
    // clip gets a bounded silent track in the ladder (TRD-09 §3.3).
    const opParams: Record<string, unknown> = { ...params };
    if (op === 'concat') {
      opParams.sources = await Promise.all(
        resolved.map(async (abs) => {
          const still = STILL_IMAGE.test(abs);
          if (still) return { still: true };
          const probe = await probeMedia(abs);
          return { still: false, has_audio: probe.has_audio ?? false, duration_s: probe.duration_s ?? 0 };
        }),
      );
    }
    try {
      await runFfmpegOp(op, resolved, outputAbs, opParams);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return { outputs: {}, actual_usd: 0, status: 'failed', error: `ffmpeg ${op} failed: ${detail}` };
    }
    const indexed = await indexAsset(db, root, targetRelative, run.libraryId);
    const assetId = indexed.sidecar.asset_id;
    for (const parentId of inputs) {
      await db.db.insert(assetLineage).values({ childId: assetId, parentId, role: op }).onConflictDoNothing();
    }
    await db.db
      .update(assets)
      .set({ runId: run.runId, stepId: node.step_id, source: 'assemble' })
      .where(eq(assets.id, assetId));
    return {
      outputs: {
        result: {
          asset_id: assetId,
          assets: [assetId],
          duration_s: indexed.sidecar.file.duration_s ?? 0,
        },
        asset: assetId,
        assets: [assetId],
        path: targetRelative,
      },
      actual_usd: 0,
      status: 'completed',
    };
  }
  if (root !== '' && !isSupportedFfmpegOp(op)) {
    return {
      outputs: {},
      actual_usd: 0,
      status: 'failed',
      error: `The assemble op ${op || '(none)'} has no local ffmpeg handler.`,
    };
  }

  // No Library root: record the asset row only (the F-WFL-09 unit stub).
  let kind = 'video';
  const [primary] = inputs[0]
    ? await db.db
        .select({ id: assets.id, kind: assets.kind, hasAudio: assets.hasAudio })
        .from(assets)
        .where(eq(assets.id, inputs[0]))
        .limit(1)
    : [];
  if (primary?.kind) kind = primary.kind;
  const assetId = ulid();
  await db.db
    .insert(assets)
    .values({
      id: assetId,
      path: targetRelative,
      folderPath: run.folder,
      kind,
      source: 'assemble',
      runId: run.runId,
      stepId: node.step_id,
      createdAt: new Date(),
    })
    .onConflictDoNothing();
  for (const parentId of inputs) {
    await db.db.insert(assetLineage).values({ childId: assetId, parentId, role: op }).onConflictDoNothing();
  }
  return {
    outputs: {
      result: { asset_id: assetId, assets: [assetId] },
      asset: assetId,
      assets: [assetId],
      path: targetRelative,
    },
    actual_usd: 0,
    status: 'completed',
  };
}

// An export step: copy or rename each expanded file into the run folder under
// its name, tag it, and record the written paths (TRD-12 §4, F-WFL-09). A file's
// ref is an asset id resolved to its Library path; copying keeps the source and
// writes a deliverable copy into the dated run folder so the manifest and disk
// agree. Reference registration is recorded for the character engine to pick up.
async function exportFiles(
  db: DatabaseState,
  run: RunContext,
  rendered: ExpandedExportStep,
): Promise<StepResult> {
  const written: Array<{ asset: string; path: string }> = [];
  const libraryRoot = run.libraryRoot;
  for (const file of rendered.files) {
    const [assetRow] = await db.db
      .select({ id: assets.id, path: assets.path })
      .from(assets)
      .where(eq(assets.id, file.ref))
      .limit(1);
    const relativeName = file.name ?? `${file.ref}`;
    const targetRelative = join(run.folder, relativeName);
    if (assetRow && libraryRoot && libraryRoot !== '') {
      try {
        const sourceAbsolute = join(libraryRoot, assetRow.path);
        const targetAbsolute = join(libraryRoot, targetRelative);
        mkdirSync(dirname(targetAbsolute), { recursive: true });
        if (existsSync(sourceAbsolute) && sourceAbsolute !== targetAbsolute) {
          copyFileSync(sourceAbsolute, targetAbsolute);
        }
      } catch {
        // A copy failure does not fail the run; the manifest records the intent
        // and a reindex can rebuild the folder from the assets' own sidecars.
      }
      // Tag the source asset with each export tag (idempotent).
      for (const tag of file.tags) {
        await db.db.insert(assetTags).values({ assetId: assetRow.id, tag }).onConflictDoNothing();
      }
    }
    written.push({ asset: file.ref, path: targetRelative });
  }
  return {
    outputs: {
      result: {
        assets: written.map((entry) => entry.asset),
        asset_id: written[0]?.asset ?? '',
        paths: written.map((entry) => entry.path),
      },
      assets: written.map((entry) => entry.asset),
      asset: written[0]?.asset ?? '',
      paths: written.map((entry) => entry.path),
      files: written,
    },
    actual_usd: 0,
    status: 'completed',
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
  const canonical = canonicalRequestForStep(rendered, scope);
  // The plan total was confirmed at Approve, so a step confirms at the engine's
  // own estimate for it rather than the plan step figure (which may be zero when
  // the plan could not route the step before its runtime inputs existed). This
  // keeps the money path — estimate, confirm, reserve, ledger — while honouring
  // the single approval the user already gave for the whole run.
  let confirmedCost = planStep?.estimate_usd ?? 0;
  try {
    const prepared = await engine.estimate(canonical.request, canonical.constraints);
    const engineEstimate = prepared.estimate.authoritative_usd ?? prepared.estimate.estimate_usd;
    if (engineEstimate > confirmedCost) confirmedCost = engineEstimate;
  } catch {
    // If the engine cannot estimate here, createJob will surface the same error.
  }
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

  // Wait for the job's terminal state, bounded by the engine's own poll window so
  // a real video or lip-sync step that runs long is not cut off. waitForJob
  // returns the instant the job is terminal, so this never slows a fast step.
  const terminal = await engine.waitForJob(created.job_id, engine.pollWindowMs);
  const assetIds = await jobAssetIds(db, created.job_id);
  const settled = ['completed', 'failed', 'cancelled', 'moderated'].includes(terminal.status);
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
      job_id: created.job_id,
      status: 'completed',
    };
  }
  return {
    outputs: {},
    // Money is only owed for work that finished. A job that was moderated is free,
    // and a job that had not settled when the wait ended has produced nothing yet,
    // so neither is charged; only a job the provider actually failed carries the
    // cost the provider reports.
    actual_usd: terminal.status === 'failed' ? actual : 0,
    job_id: created.job_id,
    status: terminal.status === 'moderated' ? 'moderated' : 'failed',
    // Name the honest outcome: a settled failure says so, an unsettled job says
    // it is still running rather than pretending the provider refused it.
    error: settled ? terminal.status : `not_settled:${terminal.status}`,
    // Only a settled failure is worth another attempt. An unsettled job must never
    // be resubmitted after an ambiguous wait; its stored request is re-polled.
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
    ...(node.job_id === undefined ? {} : { jobId: node.job_id }),
    ...(node.inputs === undefined ? {} : { inputs: node.inputs }),
    ...(node.error === undefined ? {} : { error: node.error }),
    attempts: node.attempts,
    // A gated step that is pending again with no cleared gate has been reset for a
    // re-run, so its recorded approval is dropped and the checkpoint asks again
    // (F-WFL-04). Any other state leaves the recorded approval time alone.
    ...(status === 'pending' && node.approval_cleared !== true ? { approvedAt: null } : {}),
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

// A stable sha256 of a workflow's canonical definition, for the manifest's
// workflow.sha256 (F-WFL-09).
function workflowSha256(workflow: WorkflowFile): string {
  return createHash('sha256').update(JSON.stringify(workflow)).digest('hex');
}

// The Characters a run used: every registered handle referenced by the plan's
// inputs, with the version currently resolved, de-duplicated (F-WFL-09).
async function charactersUsedIn(
  db: DatabaseState,
  plan: Plan,
): Promise<Array<{ handle: string; version: number }>> {
  const handles = new Set<string>();
  const scan = (value: unknown): void => {
    if (typeof value === 'string') {
      for (const match of value.matchAll(/@([a-z0-9][a-z0-9_-]*)/gi)) {
        if (match[1]) handles.add(match[1].toLowerCase());
      }
      // A workflow input that names a Character carries the bare handle, not an @.
      if (/^[a-z0-9][a-z0-9_-]*$/i.test(value)) handles.add(value.toLowerCase());
    } else if (Array.isArray(value)) {
      for (const item of value) scan(item);
    } else if (value && typeof value === 'object') {
      for (const item of Object.values(value as Record<string, unknown>)) scan(item);
    }
  };
  scan(plan.inputs);
  const out: Array<{ handle: string; version: number }> = [];
  const heads = await listCharacters(db);
  const byHandle = new Map(heads.map((head) => [head.handle.toLowerCase(), head] as const));
  for (const handle of handles) {
    const head = byHandle.get(handle);
    if (head) out.push({ handle: head.handle, version: head.current_version });
  }
  return out;
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
    const rows = await db.db
      .select({ parentRunId: runs.parentRunId })
      .from(runs)
      .where(eq(runs.id, runId))
      .limit(1);
    const parentRunId = rows[0]?.parentRunId ?? undefined;
    const manifest = buildManifest({
      runId,
      ...(parentRunId ? { parentRunId } : {}),
      workflow,
      plan: runPlan,
      state,
      folder,
      startedAt,
      sha256: workflowSha256(workflow),
      charactersUsed: await charactersUsedIn(db, runPlan),
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
    inputs: Record<string, unknown> | null;
    outputs: { assets: string[] } | null;
    logs: string | null;
    unit_price: Record<string, unknown> | null;
  }>;
}> {
  const [run] = await db.db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) throw new KilnryError('NOT_FOUND', 'Run not found.');
  const steps = await db.db.select().from(runSteps).where(eq(runSteps.runId, runId));
  // The unit price a spending step ran at, read from its job (F-WFL-03 cost tab).
  const jobIds = steps.map((step) => step.jobId).filter((id): id is string => Boolean(id));
  const jobRows = jobIds.length > 0 ? await db.db.select().from(jobs).where(inArray(jobs.id, jobIds)) : [];
  const unitPriceByJob = new Map(jobRows.map((job) => [job.id, job.unitPrice] as const));
  // The asset ids a step produced, from its persisted outputs.
  const assetIdsOf = (outputs: Record<string, unknown> | null): string[] => {
    if (!outputs) return [];
    const single = outputs.asset ?? outputs.assets;
    if (Array.isArray(single)) return single.filter((v): v is string => typeof v === 'string');
    return typeof single === 'string' && single !== '' ? [single] : [];
  };
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
        inputs: step.inputs ?? null,
        outputs: { assets: assetIdsOf(step.outputs) },
        logs: step.logs ?? null,
        unit_price: (step.jobId ? (unitPriceByJob.get(step.jobId) ?? null) : null) as Record<
          string,
          unknown
        > | null,
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

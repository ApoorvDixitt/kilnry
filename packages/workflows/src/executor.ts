// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The workflow executor (F-WFL-06, TRD-12 §6). It drives a plan to completion:
// it expands the steps into a run graph, then loops, running every step whose
// dependencies are met and whose `when` holds, until nothing is pending. This is
// where the checkpoint (F-WFL-04) and retry / model-swap (F-WFL-05) behaviour
// lives:
//   • an approval step (or any step marked approval) pauses the run with status
//     awaiting_approval until the host answers; a hard checkpoint always pauses,
//     a soft one proceeds when the run is automatic or approvals are skipped.
//   • a failed spending step is retried up to retry.max, optionally rewording the
//     prompt; when retries run out its alternates are tried as a model swap, each
//     recorded as an adjustment; otherwise its on_fail policy decides.
//   • retryStep / swapModel / rerunFrom reset a step and its dependants to pending
//     so the host can re-run part of a finished run after confirming the delta.
//
// The package owns no database and no provider. The host injects an Effects
// object: runStep performs one tool call (or a local assemble/export) and returns
// its outputs and actual cost; persist checkpoints the run after every state
// change; and decide answers a checkpoint. This keeps the state machine pure and
// unit-testable with stub effects, and identical in the app.

import { renderDeep, renderString, type Scope } from './template.js';
import type { Step, WorkflowFile } from './schema.js';

export type StepStatus =
  'pending' | 'running' | 'waiting' | 'completed' | 'failed' | 'skipped' | 'denied' | 'cancelled';

export type RunStatus = 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'cancelled';

/** One node in the run graph: an expanded step with its live state. */
export interface RunStep {
  step_id: string;
  /** The unique instance id: `<step.id>` or `<step.id>[k]` inside a foreach. */
  instance_id: string;
  kind: Step['kind'];
  step: Step;
  status: StepStatus;
  depends_on: string[];
  scope_extra: Record<string, unknown>;
  outputs: Record<string, unknown>;
  model?: string;
  provider?: string;
  actual_usd: number;
  attempts: number;
  adjustments: string[];
  error?: string;
  approval: boolean | 'hard' | 'soft';
}

export interface RunState {
  status: RunStatus;
  steps: RunStep[];
  spent_usd: number;
}

/** What one step's execution produced. */
export interface StepResult {
  outputs: Record<string, unknown>;
  actual_usd?: number;
  model?: string;
  provider?: string;
  status: 'completed' | 'failed' | 'moderated';
  error?: string;
  retryable?: boolean;
}

export interface RunOptions {
  /** Run automatically: soft checkpoints proceed without pausing. */
  automatic?: boolean;
  /** The user ticked "Skip approvals": soft, skippable checkpoints proceed. */
  skipApprovals?: boolean;
}

export interface Effects {
  /** Run one spending or assemble/export/set step; return its result. */
  runStep: (step: RunStep, rendered: Step, scope: Scope) => Promise<StepResult>;
  /** Persist the run after a state change (checkpoint; atomic tmp+rename). */
  persist?: (state: RunState) => Promise<void> | void;
  /**
   * Answer a checkpoint. Returns the chosen option id ('approve' proceeds, 'deny'
   * denies) or 'wait' to pause the run for the host to answer out of band.
   */
  decide?: (
    step: RunStep,
    scope: Scope,
  ) => Promise<'approve' | 'deny' | 'wait'> | 'approve' | 'deny' | 'wait';
}

// ── expansion ────────────────────────────────────────────────────────────────

function freshScope(base: Scope, extra: Record<string, unknown>): Scope {
  return { ...base, ...extra };
}

// Expand the workflow steps into run nodes, resolving foreach counts and branch
// sides against the given scope. Nested instance ids carry the iteration index.
function expandRun(steps: Step[], scope: Scope, prefix: string, extra: Record<string, unknown>): RunStep[] {
  const out: RunStep[] = [];
  for (const step of steps) {
    if (step.kind === 'branch') {
      // A branch is expanded lazily: rather than evaluating `when` now (it may
      // read a step output that is not yet produced, e.g. a QA gate over clip
      // results), push the condition onto each child as an added guard and
      // expand both sides. The run loop then evaluates each child's `when` only
      // once its dependencies — including the steps the condition reads — are
      // ready, reusing the same skip-when-false machinery every step uses. A
      // `then` child runs when the condition holds; an `else` child when it does
      // not.
      out.push(...expandRun(guardSteps(step.then, step.when, false), scope, prefix, extra));
      out.push(...expandRun(guardSteps(step.else, step.when, true), scope, prefix, extra));
      continue;
    }
    if (step.kind === 'foreach') {
      const over = renderString(step.over, freshScope(scope, extra));
      const items = Array.isArray(over) ? over : [];
      items.forEach((item, index) => {
        const childExtra = { ...extra, [step.as]: item, [step.index_as]: index };
        out.push(...expandRun(step.steps, scope, `${step.id}[${index}].`, childExtra));
      });
      continue;
    }
    const instanceId = `${prefix}${step.id}`;
    out.push({
      step_id: step.id,
      instance_id: instanceId,
      kind: step.kind,
      step,
      status: 'pending',
      depends_on: [...step.depends_on],
      scope_extra: extra,
      outputs: {},
      actual_usd: 0,
      attempts: 0,
      adjustments: [],
      approval: step.approval,
    });
  }
  return out;
}

// Combine a branch's condition with each child's own `when` so the child runs
// only on the correct side of the branch. `negate` handles the else side. The
// child keeps its own condition too, so an inner `when` still applies.
function guardSteps(children: Step[], condition: string, negate: boolean): Step[] {
  const guard = negate ? `!(${unwrap(condition)})` : `(${unwrap(condition)})`;
  return children.map((child) => {
    const own = child.when === undefined ? undefined : unwrap(child.when);
    const combined = own === undefined ? guard : `${guard} && (${own})`;
    return { ...child, when: `{{ ${combined} }}` } as Step;
  });
}

// Strip a single surrounding `{{ }}` so two conditions can be combined into one
// expression; a bare expression is returned unchanged.
function unwrap(expr: string): string {
  const trimmed = expr.trim();
  const match = /^\{\{(.*)\}\}$/s.exec(trimmed);
  return match?.[1]?.trim() ?? trimmed;
}

function truthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value);
}

// The explicit and implicit dependencies of a step: explicit depends_on plus any
// `steps.<id>` referenced in its templated fields.
function impliedDependencies(step: Step): string[] {
  const deps = new Set<string>(step.depends_on);
  const text = JSON.stringify(step);
  for (const match of text.matchAll(/steps\.([a-z0-9][a-z0-9_-]*)/g)) {
    if (match[1] !== undefined) deps.add(match[1]);
  }
  return [...deps];
}

// ── the run loop ───────────────────────────────────────────────────────────

/**
 * Build the initial run graph (every step expanded to pending) without running
 * anything. The host uses this on resume to rebuild the node list, then overlays
 * the persisted status and outputs from run_steps before calling execute with it.
 */
export function expandRunState(workflow: WorkflowFile, baseScope: Scope): RunState {
  return { status: 'running', steps: expandRun(workflow.steps, baseScope, '', {}), spent_usd: 0 };
}

/**
 * Execute a plan's steps to a terminal or awaiting state. Returns the run state;
 * when a hard checkpoint is reached with no decision, the run pauses with status
 * awaiting_approval and the caller resumes it later by calling run again after
 * recording the decision.
 */
export async function execute(
  workflow: WorkflowFile,
  baseScope: Scope,
  effects: Effects,
  options: RunOptions = {},
  existing?: RunState,
): Promise<RunState> {
  const nodes = existing?.steps ?? expandRun(workflow.steps, baseScope, '', {});
  const state: RunState = existing ?? { status: 'running', steps: nodes, spent_usd: 0 };
  state.status = 'running';

  const byStepId = (id: string): RunStep[] => {
    const direct = state.steps.filter((node) => node.step_id === id);
    if (direct.length > 0) return direct;
    // A foreach container id (e.g. `clips`) is not a node itself; a dependency on
    // it means every child instance of that foreach (`clips[k].*`). Resolve those
    // so a step reading `steps.clips.assets` waits for the whole foreach.
    const prefix = `${id}[`;
    return state.steps.filter((node) => node.instance_id.startsWith(prefix));
  };
  const done = (node: RunStep): boolean => node.status === 'completed' || node.status === 'skipped';

  const checkpoint = async (): Promise<void> => {
    await effects.persist?.(state);
  };

  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const node of state.steps) {
      if (node.status !== 'pending') continue;
      // A step inside foreach X may reference `steps.X.outputs[k-1]` (the prior
      // iteration); that is not a dependency on its own container — sequencing
      // within a foreach is handled by concurrency, not the DAG — so drop the
      // enclosing container id from the implied dependencies to avoid a
      // self-deadlock.
      const enclosing = node.instance_id.match(/^([a-z0-9][a-z0-9_-]*)\[/)?.[1];
      const deps = impliedDependencies(node.step).filter((dep) => dep !== enclosing);
      const ready = deps.every(
        (dep) => (byStepId(dep).every(done) && byStepId(dep).length > 0) || byStepId(dep).length === 0,
      );
      if (!ready) continue;

      const scope = { ...baseScope, ...node.scope_extra, ...stepsScope(state) };

      // Skip when its `when` is false.
      if (node.step.when !== undefined && !truthy(renderString(node.step.when, scope))) {
        node.status = 'skipped';
        progressed = true;
        await checkpoint();
        continue;
      }

      // A checkpoint pauses or proceeds per its mode.
      if (node.kind === 'approval' || node.approval !== false) {
        const mode = node.kind === 'approval' ? approvalMode(node.step) : node.approval;
        const skippable = node.kind === 'approval' ? approvalSkippable(node.step) : true;
        const canProceed =
          mode === 'soft' && skippable && (options.automatic === true || options.skipApprovals === true);
        if (canProceed) {
          node.status = 'completed';
          node.outputs = { choice: 'approve' };
          progressed = true;
          await checkpoint();
          continue;
        }
        const decision = (await effects.decide?.(node, scope)) ?? 'wait';
        if (decision === 'wait') {
          node.status = 'waiting';
          state.status = 'awaiting_approval';
          await checkpoint();
          return state;
        }
        if (decision === 'deny') {
          node.status = 'denied';
          progressed = true;
          await checkpoint();
          if (node.step.on_fail === 'fail') {
            state.status = 'cancelled';
            await checkpoint();
            return state;
          }
          continue;
        }
        node.status = 'completed';
        node.outputs = { choice: 'approve' };
        progressed = true;
        await checkpoint();
        continue;
      }

      // Run the step (set/generate/transform/assemble/analyze/export).
      node.status = 'running';
      await checkpoint();
      const rendered = renderDeep(node.step, scope) as Step;
      const result = await runWithRetry(node, rendered, scope, effects);
      // The step's declared `outputs` are templates over its result (e.g.
      // `ok: '{{ result.structured.ok }}'`, `transcript: '{{ result.assets[0] }}'`).
      // Evaluate them against a scope that binds `result` to what the step
      // produced, so downstream steps read the named outputs the YAML promises;
      // fall back to the raw result outputs when a step declares none.
      const declared = node.step.outputs ?? {};
      // The declared `outputs` templates reference `result` — the step's result
      // namespace (assets, asset_id, structured, words). A step result carries
      // that under `outputs.result`; expose it as `result` and also spread the
      // raw outputs so `{{ result.assets[0] }}` and a bare `{{ asset }}` both
      // resolve.
      const resultNamespace =
        result.outputs.result !== undefined && typeof result.outputs.result === 'object'
          ? (result.outputs.result as Record<string, unknown>)
          : result.outputs;
      const resultScope = { ...scope, result: resultNamespace, ...result.outputs };
      const named: Record<string, unknown> = {};
      for (const [key, expr] of Object.entries(declared)) {
        try {
          named[key] = renderString(expr, resultScope);
        } catch {
          named[key] = undefined;
        }
      }
      node.outputs = Object.keys(named).length > 0 ? { ...result.outputs, ...named } : result.outputs;
      node.actual_usd += result.actual_usd ?? 0;
      state.spent_usd += result.actual_usd ?? 0;
      if (result.model !== undefined) node.model = result.model;
      if (result.provider !== undefined) node.provider = result.provider;
      if (result.status === 'completed') {
        node.status = 'completed';
      } else {
        node.status = 'failed';
        if (result.error !== undefined) node.error = result.error;
        const stopped = applyFailPolicy(node, state);
        if (stopped) {
          await checkpoint();
          return state;
        }
      }
      progressed = true;
      await checkpoint();
    }
  }

  // Terminal status: failed if any step failed under a 'fail' policy (handled
  // above); otherwise completed.
  if (state.status === 'running') state.status = 'completed';
  await checkpoint();
  return state;
}

// Retry a spending step up to retry.max, then try alternates as a model swap.
async function runWithRetry(
  node: RunStep,
  rendered: Step,
  scope: Scope,
  effects: Effects,
): Promise<StepResult> {
  const retry = 'retry' in node.step ? node.step.retry : undefined;
  const maxRetries = retry?.max ?? 0;
  let result = await attempt(node, rendered, scope, effects);
  let tries = 0;
  while (result.status !== 'completed' && result.retryable !== false && tries < maxRetries) {
    tries += 1;
    node.attempts += 1;
    if (retry?.reword) node.adjustments.push(`prompt reworded before retry ${tries}`);
    result = await attempt(node, rendered, scope, effects);
  }
  // Alternates: swap the model when retries are exhausted (F-WFL-05).
  if (result.status !== 'completed' && node.step.kind === 'generate') {
    const alternates = Array.isArray(node.step.alternates) ? node.step.alternates : [];
    for (const alternate of alternates) {
      node.adjustments.push(`model swapped to ${alternate}: ${result.error ?? 'previous model failed'}`);
      node.model = alternate;
      result = await attempt(node, { ...rendered, model: alternate } as Step, scope, effects);
      if (result.status === 'completed') break;
    }
  }
  return result;
}

async function attempt(node: RunStep, rendered: Step, scope: Scope, effects: Effects): Promise<StepResult> {
  node.attempts += 1;
  return effects.runStep(node, rendered, scope);
}

// on_fail: fail stops the run; skip marks dependants skipped; continue lets
// independent branches finish.
function applyFailPolicy(node: RunStep, state: RunState): boolean {
  const policy = node.step.on_fail;
  if (policy === 'fail') {
    state.status = 'failed';
    return true;
  }
  if (policy === 'skip') {
    for (const other of state.steps) {
      if (other.status === 'pending' && impliedDependencies(other.step).includes(node.step_id)) {
        other.status = 'skipped';
      }
    }
  }
  // 'continue' leaves independent steps to finish.
  return false;
}

// The steps namespace for template evaluation: each step id maps to its outputs,
// and a foreach id maps to the array of its iterations' outputs. A foreach
// container id (e.g. `boards`, `clips`) is not a node itself, so its namespace
// is built from its child instances: `steps.boards.outputs[k]` is the merged
// outputs of every child step in iteration k, and `steps.boards.assets` is those
// iterations' assets flattened — which is what the shipped workflows read
// (`steps.clips.assets`, `steps.boards.outputs | map('clean')`).
function stepsScope(state: RunState): { steps: Record<string, unknown> } {
  const steps: Record<string, unknown> = {};
  const groups = new Map<string, RunStep[]>();
  for (const node of state.steps) {
    const list = groups.get(node.step_id) ?? [];
    list.push(node);
    groups.set(node.step_id, list);
  }
  for (const [id, list] of groups) {
    if (list.length === 1 && list[0]!.instance_id === id) {
      steps[id] = { outputs: list[0]!.outputs, ...list[0]!.outputs, status: list[0]!.status };
    } else {
      steps[id] = {
        outputs: list.map((node) => node.outputs),
        assets: list.flatMap((node) => (Array.isArray(node.outputs.assets) ? node.outputs.assets : [])),
      };
    }
  }

  // Build each foreach container's aggregated namespace from its child instances.
  // A child instance id looks like `<container>[<k>].<child...>`; several nested
  // levels give `<outer>[<i>].<inner>[<j>].<leaf>`. Merge per top-level iteration.
  const containers = new Map<string, Map<number, Record<string, unknown>>>();
  const containerAssets = new Map<string, Map<number, string[]>>();
  for (const node of state.steps) {
    const match = /^([a-z0-9][a-z0-9_-]*)\[(\d+)\]\./.exec(node.instance_id);
    if (!match) continue;
    const container = match[1]!;
    const index = Number(match[2]);
    const byIndex = containers.get(container) ?? new Map<number, Record<string, unknown>>();
    const merged = byIndex.get(index) ?? {};
    Object.assign(merged, node.outputs);
    byIndex.set(index, merged);
    containers.set(container, byIndex);
    const assetsByIndex = containerAssets.get(container) ?? new Map<number, string[]>();
    const existing = assetsByIndex.get(index) ?? [];
    if (Array.isArray(node.outputs.assets)) existing.push(...(node.outputs.assets as string[]));
    assetsByIndex.set(index, existing);
    containerAssets.set(container, assetsByIndex);
  }
  for (const [container, byIndex] of containers) {
    // Do not shadow a real step that happens to share the id.
    if (
      steps[container] !== undefined &&
      !Array.isArray((steps[container] as { outputs?: unknown }).outputs)
    ) {
      continue;
    }
    const indices = [...byIndex.keys()].sort((a, b) => a - b);
    const outputs = indices.map((index) => byIndex.get(index) ?? {});
    const assetsByIndex = containerAssets.get(container) ?? new Map<number, string[]>();
    const assets = indices.flatMap((index) => assetsByIndex.get(index) ?? []);
    steps[container] = { outputs, assets };
  }
  return { steps };
}

function approvalMode(step: Step): 'hard' | 'soft' {
  return step.kind === 'approval' ? step.mode : 'hard';
}
function approvalSkippable(step: Step): boolean {
  return step.kind === 'approval' ? step.skippable : true;
}

/**
 * Reset a step instance and everything downstream of it to pending, so the host
 * can re-run part of a finished run (retry step / swap model / re-run from step
 * N, F-WFL-05). `modelOverride` pins a new model on the target before the re-run.
 */
export function resetFrom(state: RunState, stepId: string, modelOverride?: string): RunState {
  const targets = new Set<string>([stepId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of state.steps) {
      if (targets.has(node.step_id)) continue;
      if (impliedDependencies(node.step).some((dep) => targets.has(dep))) {
        targets.add(node.step_id);
        grew = true;
      }
    }
  }
  for (const node of state.steps) {
    if (!targets.has(node.step_id)) continue;
    node.status = 'pending';
    node.outputs = {};
    delete node.error;
    if (node.step_id === stepId && modelOverride !== undefined) {
      node.model = modelOverride;
      node.adjustments.push(`model swapped to ${modelOverride}: re-run from step`);
    }
  }
  state.status = 'running';
  return state;
}

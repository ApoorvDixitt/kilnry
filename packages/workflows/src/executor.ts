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
  /** The rendered, run-time inputs this step actually used (F-WFL-09 manifest). */
  inputs?: Record<string, unknown>;
  /** The engine job id a spending step created, for the manifest (F-WFL-09). */
  job_id?: string;
  actual_usd: number;
  attempts: number;
  adjustments: string[];
  error?: string;
  approval: boolean | 'hard' | 'soft';
  /**
   * True once this step's checkpoint has been answered with an approval. A step
   * whose `kind` is `approval` is a barrier and nothing more, so approving it
   * completes it. An `approval` marked on a working step is only a gate in front
   * of that step: once the gate is cleared the step still has to do its own work,
   * so the flag lets the run loop pass the gate and fall through to run it, and
   * lets a resumed run tell "approved, still to run" from "finished" (F-WFL-04).
   */
  approval_cleared?: boolean;
  /**
   * A foreach placeholder whose `over` reads a step output: it carries the
   * instance prefix to expand its children under once that step is ready
   * (lazy foreach expansion). Absent on every ordinary node.
   */
  deferred_prefix?: string;
}

export interface RunState {
  status: RunStatus;
  steps: RunStep[];
  spent_usd: number;
  /**
   * The values `set` steps stored at run time, keyed by the foreach scope they
   * ran in ('' for top level, `clips[2].` inside an iteration). They overlay the
   * plan's vars, so a value read from an earlier step's output reaches later
   * templates and the run outputs (TRD-12 §6). Rebuilt from the completed set
   * steps' outputs on resume.
   */
  vars?: Record<string, Record<string, unknown>>;
}

/** What one step's execution produced. */
export interface StepResult {
  outputs: Record<string, unknown>;
  actual_usd?: number;
  model?: string;
  provider?: string;
  /** The engine job id a spending step created, recorded on the node (F-WFL-09). */
  job_id?: string;
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
  runStep: (step: RunStep, rendered: Step | ExpandedExportStep, scope: Scope) => Promise<StepResult>;
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
      // A foreach whose `over` reads a step output cannot be counted until that
      // step has produced it. Expanding now (before the step runs) would give
      // zero iterations. Emit a deferred placeholder the run loop expands once
      // the steps the `over` reads are ready (the same lazy treatment a branch
      // gets). A foreach over inputs, defaults or vars has no such dependency and
      // expands straight away.
      const overDeps = [...JSON.stringify(step.over).matchAll(/steps\.([a-z0-9][a-z0-9_-]*)/g)].map(
        (match) => match[1]!,
      );
      if (overDeps.length > 0) {
        out.push({
          step_id: `${step.id}@deferred`,
          instance_id: `${prefix}${step.id}@deferred`,
          kind: 'foreach',
          step,
          status: 'pending',
          depends_on: [...step.depends_on, ...overDeps],
          scope_extra: extra,
          outputs: {},
          actual_usd: 0,
          attempts: 0,
          adjustments: [],
          approval: false,
          deferred_prefix: prefix,
        });
        continue;
      }
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

/** One concrete file an export step writes, after array expansion (TRD-12 §4). */
export interface ExpandedExportFile {
  ref: string;
  name?: string;
  tags: string[];
}

/** An export step whose files are expanded to concrete per-file descriptors. */
export interface ExpandedExportStep {
  kind: 'export';
  id: string;
  files: ExpandedExportFile[];
  register_references?: {
    character: string;
    role: string;
    view?: string;
    label?: string;
    appearance?: string;
    skip_tags: string[];
  };
  outputs: Record<string, string>;
}

// Expand an export step against a scope (TRD-12 §4 export table). A files[].ref
// that evaluates to an array expands to one file per element, with `index` and
// `file` (the matching element, whose `tags`/`meta` a foreach iteration carries)
// bound inside `name`, `tags` and `register_references`; a scalar ref is one
// file. Templates are rendered per file so `board_{{ index + 1 }}.png` resolves.
export function expandExportStep(step: Step, scope: Scope): ExpandedExportStep {
  if (step.kind !== 'export') throw new Error('expandExportStep expects an export step.');
  const out: ExpandedExportFile[] = [];
  for (const file of step.files) {
    const value = evaluateRef(file.ref, scope);
    const elements = Array.isArray(value) ? value : [value];
    elements.forEach((element, index) => {
      const perFile: Scope = { ...scope, index, file: element };
      const ref = refString(element);
      if (ref === undefined) return;
      const name = file.name === undefined ? undefined : String(renderString(file.name, perFile));
      const tags = file.tags
        .map((tag) => renderString(tag, perFile))
        .filter((tag): tag is string => typeof tag === 'string' && tag !== '');
      out.push({ ref, ...(name === undefined ? {} : { name }), tags });
    });
  }
  let register: ExpandedExportStep['register_references'];
  if (step.register_references) {
    const registration = step.register_references;
    register = {
      character: String(renderString(registration.character, scope)),
      role: String(renderString(registration.role, scope)),
      ...(registration.view === undefined ? {} : { view: String(renderString(registration.view, scope)) }),
      ...(registration.label === undefined ? {} : { label: String(renderString(registration.label, scope)) }),
      ...(registration.appearance === undefined
        ? {}
        : { appearance: String(renderString(registration.appearance, scope)) }),
      skip_tags: registration.skip_tags,
    };
  }
  return {
    kind: 'export',
    id: step.id,
    files: out,
    ...(register ? { register_references: register } : {}),
    outputs: step.outputs,
  };
}

// Evaluate a MediaRef that may be a template resolving to a string or an array.
function evaluateRef(ref: string, scope: Scope): unknown {
  return renderString(ref, scope);
}

// The asset id or path a resolved ref element denotes: a bare string, or the
// `asset`/`clean`/`asset_id` field of a foreach iteration's outputs object.
function refString(element: unknown): string | undefined {
  if (typeof element === 'string') return element === '' ? undefined : element;
  if (element && typeof element === 'object') {
    const record = element as Record<string, unknown>;
    for (const key of ['asset', 'clean', 'asset_id', 'raw']) {
      if (typeof record[key] === 'string' && record[key] !== '') return record[key] as string;
    }
  }
  return undefined;
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

// ── run-time vars (TRD-12 §6: "set → evaluate, store outputs, complete") ─────

// The foreach scopes an instance id sits in, outermost first: '' for top level,
// then `a[1].`, `a[1].b[2].` for nested iterations.
function scopePrefixes(instanceId: string): string[] {
  const prefixes = [''];
  let accumulated = '';
  for (const match of instanceId.matchAll(/[a-z0-9][a-z0-9_-]*\[\d+\]\./g)) {
    accumulated += match[0];
    prefixes.push(accumulated);
  }
  return prefixes;
}

function ownPrefix(instanceId: string): string {
  return scopePrefixes(instanceId).at(-1)!;
}

// The vars a node sees: the plan's vars, overlaid by every run-time scope it
// sits in, innermost last.
export function varsFor(
  state: RunState,
  planVars: Record<string, unknown>,
  instanceId: string,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...planVars };
  for (const prefix of scopePrefixes(instanceId)) Object.assign(merged, state.vars?.[prefix] ?? {});
  return merged;
}

// Rebuild the run-time vars from the set steps that already completed, in graph
// order, so a resumed run reads what the earlier part of the run stored.
function restoreVars(state: RunState): void {
  state.vars = {};
  for (const node of state.steps) {
    if (node.kind !== 'set' || node.status !== 'completed') continue;
    const prefix = ownPrefix(node.instance_id);
    state.vars[prefix] = { ...(state.vars[prefix] ?? {}), ...node.outputs };
  }
}

// The set steps a node must wait for: an earlier set step, in a scope the node
// can see, that stores a var the node reads. Without this a step reading
// `vars.master` could run before the set step that fills it.
function varDependencies(state: RunState, index: number): RunStep[] {
  const node = state.steps[index]!;
  const names = new Set(
    [...JSON.stringify(node.step).matchAll(/vars\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((match) => match[1]!),
  );
  if (names.size === 0) return [];
  const visible = new Set(scopePrefixes(node.instance_id));
  return state.steps
    .slice(0, index)
    .filter(
      (candidate) =>
        candidate.kind === 'set' &&
        visible.has(ownPrefix(candidate.instance_id)) &&
        candidate.step.kind === 'set' &&
        Object.keys(candidate.step.values).some((key) => names.has(key)),
    );
}

// The `steps.…` and `vars.…` paths in a template that have no value, for a set
// step's failure message.
function missingReferences(expr: string, scope: Scope): string[] {
  const missing: string[] = [];
  for (const match of expr.matchAll(/\b(?:steps|vars)\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+|\[\d+\])*/g)) {
    let value: unknown;
    try {
      value = renderString(`{{ ${match[0]} }}`, scope);
    } catch {
      // A path the expression language cannot read is itself a missing one.
      value = undefined;
    }
    if (value === undefined && !missing.includes(match[0])) missing.push(match[0]);
  }
  return missing;
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
  restoreVars(state);
  const planVars = (baseScope.vars as Record<string, unknown> | undefined) ?? {};

  const byStepId = (id: string): RunStep[] => {
    const direct = state.steps.filter((node) => node.step_id === id);
    if (direct.length > 0) return direct;
    // A foreach container id (e.g. `clips`) is not a node itself; a dependency on
    // it means every child instance of that foreach (`clips[k].*`). Resolve those
    // so a step reading `steps.clips.assets` waits for the whole foreach.
    const prefix = `${id}[`;
    const children = state.steps.filter((node) => node.instance_id.startsWith(prefix));
    if (children.length > 0) return children;
    // A deferred foreach has not expanded its children yet; a dependant must
    // wait on the pending placeholder so it does not run before the foreach
    // produces its instances (lazy foreach).
    return state.steps.filter((node) => node.step_id === `${id}@deferred`);
  };
  const done = (node: RunStep): boolean => node.status === 'completed' || node.status === 'skipped';
  // A dependency on a step that also lives in the reader's own foreach
  // iteration means that iteration's instance; otherwise every instance.
  const dependencyNodes = (dep: string, reader: RunStep): RunStep[] => {
    for (const prefix of scopePrefixes(reader.instance_id).reverse()) {
      if (prefix === '') break;
      const local = state.steps.filter((node) => node.instance_id === `${prefix}${dep}`);
      if (local.length > 0) return local;
    }
    return byStepId(dep);
  };

  const checkpoint = async (): Promise<void> => {
    await effects.persist?.(state);
  };

  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const [index, node] of state.steps.entries()) {
      if (node.status !== 'pending') continue;
      // A step inside foreach X may reference `steps.X.outputs[k-1]` (the prior
      // iteration); that is not a dependency on its own container — sequencing
      // within a foreach is handled by concurrency, not the DAG — so drop the
      // enclosing container id from the implied dependencies to avoid a
      // self-deadlock.
      const enclosing = node.instance_id.match(/^([a-z0-9][a-z0-9_-]*)\[/)?.[1];
      const deps = impliedDependencies(node.step).filter((dep) => dep !== enclosing);
      const ready =
        deps.every((dep) => {
          const nodes = dependencyNodes(dep, node);
          return nodes.length === 0 || nodes.every(done);
        }) && varDependencies(state, index).every(done);
      if (!ready) continue;

      const scope = {
        ...baseScope,
        ...node.scope_extra,
        steps: iterationSteps(state, node.instance_id),
        vars: varsFor(state, planVars, node.instance_id),
      };

      // Skip when its `when` is false.
      if (node.step.when !== undefined && !truthy(renderString(node.step.when, scope))) {
        node.status = 'skipped';
        progressed = true;
        await checkpoint();
        continue;
      }

      // A deferred foreach: its `over` reads a step output that is now ready, so
      // expand its children in place and mark the placeholder done. The children
      // enter the graph pending and run on later passes (lazy foreach, F-WFL-06).
      if (node.kind === 'foreach' && node.deferred_prefix !== undefined && node.step.kind === 'foreach') {
        const foreachStep = node.step;
        const over = renderString(foreachStep.over, {
          ...baseScope,
          ...node.scope_extra,
          steps: scope.steps,
          vars: scope.vars,
        });
        const items = Array.isArray(over) ? over : [];
        const children: RunStep[] = [];
        items.forEach((item, index) => {
          const childExtra = {
            ...node.scope_extra,
            [foreachStep.as]: item,
            [foreachStep.index_as]: index,
          };
          children.push(
            ...expandRun(
              foreachStep.steps,
              baseScope,
              `${node.deferred_prefix}${foreachStep.id}[${index}].`,
              childExtra,
            ),
          );
        });
        node.status = 'completed';
        node.outputs = {};
        const at = state.steps.indexOf(node);
        state.steps.splice(at + 1, 0, ...children);
        progressed = true;
        await checkpoint();
        continue;
      }

      // A checkpoint gates the step. `kind: approval` is a barrier and nothing
      // more: approving it completes it. An `approval` marked on a working step
      // is only a gate in front of that step, so once the gate is cleared the
      // loop falls through and the step runs its own work (F-WFL-04, PRD-10 §4).
      const isBarrier = node.kind === 'approval';
      if ((isBarrier || node.approval !== false) && node.approval_cleared !== true) {
        const mode = isBarrier ? approvalMode(node.step) : node.approval;
        const skippable = isBarrier ? approvalSkippable(node.step) : true;
        const canProceed =
          mode === 'soft' && skippable && (options.automatic === true || options.skipApprovals === true);
        const decision = canProceed ? 'approve' : ((await effects.decide?.(node, scope)) ?? 'wait');
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
        node.approval_cleared = true;
        if (isBarrier) {
          node.status = 'completed';
          node.outputs = { choice: 'approve' };
          progressed = true;
          await checkpoint();
          continue;
        }
        // The gate is cleared; fall through and run the step itself.
        await checkpoint();
      }

      // A set step runs here, not in the host: evaluate its values with the
      // steps namespace available, store them as run-time vars for every later
      // template and the run outputs, and complete (TRD-12 §6). A value may read
      // a key set earlier in the same step.
      if (node.step.kind === 'set') {
        const values: Record<string, unknown> = {};
        try {
          for (const [key, expr] of Object.entries(node.step.values)) {
            const valueScope = { ...scope, vars: { ...scope.vars, ...values } };
            const value = renderString(expr, valueScope);
            // A value that resolves to nothing because a step or var it reads
            // was skipped or produced no output fails the set and names the
            // path: storing undefined left a silently empty var for every later
            // step. An optional input left blank resolves to an explicit null.
            if (value === undefined) {
              const missing = missingReferences(expr, valueScope);
              if (missing.length > 0) {
                throw new Error(
                  `${key} did not resolve: ${missing.join(', ')} ${missing.length === 1 ? 'has' : 'have'} no value (from ${expr.trim()})`,
                );
              }
              values[key] = null;
              continue;
            }
            values[key] = value;
          }
        } catch (error) {
          node.status = 'failed';
          node.error = `Set step ${node.instance_id} failed: ${error instanceof Error ? error.message : String(error)}`;
          progressed = true;
          if (applyFailPolicy(node, state)) {
            await checkpoint();
            return state;
          }
          await checkpoint();
          continue;
        }
        const prefix = ownPrefix(node.instance_id);
        state.vars ??= {};
        state.vars[prefix] = { ...(state.vars[prefix] ?? {}), ...values };
        node.outputs = values;
        node.status = 'completed';
        progressed = true;
        await checkpoint();
        continue;
      }

      // Run the step (generate/transform/assemble/analyze/export).
      node.status = 'running';
      await checkpoint();
      let rendered: Step | ExpandedExportStep;
      try {
        rendered =
          node.step.kind === 'export'
            ? expandExportStep(node.step, scope)
            : (renderDeep(node.step, scope) as Step);
      } catch (error) {
        // Name the step whose template could not render, instead of a bare
        // "expected a number" with no location (F-WFL-04).
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Step ${node.instance_id} could not render: ${reason}`, { cause: error });
      }
      // A model swapped onto the node — by a re-run's modelOverride (F-WFL-05) or
      // carried from a prior attempt's alternate — is the model that must route.
      // The rendered step comes from node.step, which still holds the workflow's
      // original model, so without this the swap changed only the manifest note
      // and the job ran on the old model. An export step has no model field.
      if (node.step.kind !== 'export' && node.model !== undefined && (rendered as Step).kind !== 'assemble') {
        (rendered as { model?: string }).model = node.model;
      }
      // Record the rendered inputs this step ran with, for the manifest
      // (F-WFL-09): a generate/transform step's prompt, params and media, an
      // analyze step's task and instructions. Read from the rendered step so the
      // manifest shows the resolved values, not the templates.
      node.inputs = renderedInputs(rendered);
      const result = await runWithRetry(node, rendered, scope, effects);
      if (result.job_id !== undefined) node.job_id = result.job_id;
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
  rendered: Step | ExpandedExportStep,
  scope: Scope,
  effects: Effects,
): Promise<StepResult> {
  const retry = 'retry' in node.step ? node.step.retry : undefined;
  const maxRetries = retry?.max ?? 0;
  let result = await attempt(node, rendered, scope, effects);
  let tries = 0;
  while (result.status !== 'completed' && result.retryable !== false && tries < maxRetries) {
    tries += 1;
    // attempt() advances node.attempts; the client request id keys off it, so
    // each retry is a distinct request rather than a replay of the failed job.
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

async function attempt(
  node: RunStep,
  rendered: Step | ExpandedExportStep,
  scope: Scope,
  effects: Effects,
): Promise<StepResult> {
  node.attempts += 1;
  return effects.runStep(node, rendered, scope);
}

// The rendered inputs a step ran with, for the manifest (F-WFL-09). Only the
// fields that describe what was asked of the provider are kept: the prompt,
// params and media for a generate/transform, the task and instructions for an
// analyze. Structural keys (id, kind, depends_on, outputs templates) are not
// inputs and are left out.
function renderedInputs(rendered: Step | ExpandedExportStep): Record<string, unknown> {
  const step = rendered as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of ['prompt', 'params', 'medias', 'task', 'instructions', 'op', 'source', 'inputs']) {
    if (step[key] !== undefined) out[key] = step[key];
  }
  return out;
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

// The steps namespace a node sees: the run-wide one, with every step of the
// node's own foreach iterations overlaid by that iteration's instance, innermost
// last. Inside an iteration a sibling's bare `steps.tts_dub.outputs.asset`
// therefore reads this iteration's output; a foreach container id keeps its
// aggregated form.
function iterationSteps(state: RunState, instanceId: string): Record<string, unknown> {
  const { steps } = stepsScope(state);
  for (const prefix of scopePrefixes(instanceId)) {
    if (prefix === '') continue;
    for (const node of state.steps) {
      if (ownPrefix(node.instance_id) !== prefix) continue;
      steps[node.step_id] = { outputs: node.outputs, ...node.outputs, status: node.status };
    }
  }
  return steps;
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
    // Drop this step's prior spend from the run total before it re-runs; the
    // re-run adds its own actual cost. Without this a re-run's spend is counted
    // on top of the attempt it replaces, so the run total double-counts the
    // reset steps (F-WFL-05).
    state.spent_usd -= node.actual_usd;
    node.actual_usd = 0;
    node.status = 'pending';
    node.outputs = {};
    delete node.error;
    // A re-run asks again: a gate that was cleared for the previous attempt does
    // not stand in for this one (PRD-10 §4).
    delete node.approval_cleared;
    if (node.step_id === stepId && modelOverride !== undefined) {
      node.model = modelOverride;
      node.adjustments.push(`model swapped to ${modelOverride}: re-run from step`);
    }
  }
  // Guard against floating-point drift leaving a tiny negative or residual.
  if (state.spent_usd < 0) state.spent_usd = 0;
  state.status = 'running';
  return state;
}

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The workflow planner (F-WFL-06, TRD-12 §4–5). plan(workflow, inputs, ctx)
// never spends: it validates inputs against the workflow's JSON Schema, evaluates
// the top-level set steps, expands foreach and branch where the counts are known
// now, walks the resulting steps, and prices each spending leaf through the
// pricing function the caller injects. The result is a Plan the intake drawer
// renders as a per-step preview with a model chip, a cost and a total (F-WFL-02),
// and that the executor turns into a Run.
//
// The package stays pure: it holds no database and no registry. The caller (the
// web server) passes a PlanContext whose priceStep routes and estimates through
// the one estimator every other spend uses (D-26), and whose resolveInputs
// validates and defaults the inputs. This keeps the planner unit-testable with a
// stub price function and identical in the app.

import { evaluateExpression, renderDeep, renderString, type Scope } from './template.js';
import type { Step, WorkflowFile } from './schema.js';

/** A priced step in the plan preview. */
export interface PlanStep {
  step_id: string;
  name: string;
  kind: Step['kind'];
  /** The resolved capability or op, for the preview label. */
  detail?: string;
  /** The model the router chose, when the step spends. */
  model?: string;
  provider?: string;
  estimate_usd: number;
  eta_s: number;
  /** true when this step sits inside a branch whose side was kept conditionally. */
  conditional?: boolean;
  /** true when a checkpoint pauses the run at this step. */
  approval?: boolean;
}

export interface Plan {
  workflow_id: string;
  workflow_version: string;
  inputs: Record<string, unknown>;
  vars: Record<string, unknown>;
  steps: PlanStep[];
  expansions: Array<{ step_id: string; n: number }>;
  routes: Array<{ step_id: string; provider?: string; model?: string; why: string }>;
  total_estimate_usd: number;
  eta_s: number;
  warnings: string[];
  created_at: string;
}

/** What the caller injects so the planner can price without owning the registry. */
export interface PlanContext {
  /**
   * Validate and default the raw inputs against the workflow's `inputs` JSON
   * Schema. Throws when a required input is missing or a value is out of range.
   */
  resolveInputs: (workflow: WorkflowFile, inputs: Record<string, unknown>) => Record<string, unknown>;
  /**
   * Price and route one spending step. Returns the chosen model, provider,
   * estimate and eta, or a null estimate with a warning reason when no provider
   * serves it. Never spends.
   */
  priceStep: (
    step: Step,
    scope: Scope,
  ) => {
    model?: string;
    provider?: string;
    estimate_usd: number;
    eta_s: number;
    why: string;
  };
  /** Read a resolved character by handle, for the characters namespace. */
  resolveCharacter?: (handle: string) => unknown;
  now?: Date;
}

const SPENDING_KINDS = new Set<Step['kind']>(['generate', 'transform', 'analyze']);

/** Whether a step template value evaluates truthy under a scope (for `when`). */
function whenHolds(when: string | undefined, scope: Scope): boolean {
  if (when === undefined) return true;
  const value = renderString(when, scope);
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value);
}

/** Build the base scope every step sees (TRD-12 §3 namespaces). */
function baseScope(
  workflow: WorkflowFile,
  inputs: Record<string, unknown>,
  vars: Record<string, unknown>,
  ctx: PlanContext,
): Scope {
  const characters = new Proxy(
    {},
    {
      get: (_target, handle: string) => ctx.resolveCharacter?.(handle) ?? {},
    },
  );
  return {
    inputs,
    defaults: workflow.defaults,
    vars,
    characters,
    plan: vars,
    settings: {},
    run: { workflow: workflow.id },
    steps: new Proxy({}, { get: () => ({}) }),
    presets: new Proxy({}, { get: () => ({}) }),
  };
}

// Evaluate the top-level set steps in order; they may reference inputs, defaults
// and earlier vars only (TRD-12 §5 step 2).
function evaluateVars(
  workflow: WorkflowFile,
  inputs: Record<string, unknown>,
  ctx: PlanContext,
): Record<string, unknown> {
  const vars: Record<string, unknown> = {};
  for (const step of workflow.steps) {
    if (step.kind !== 'set') continue;
    const scope = baseScope(workflow, inputs, vars, ctx);
    for (const [key, expr] of Object.entries(step.values)) {
      vars[key] = renderString(expr, scope);
    }
  }
  return vars;
}

/**
 * Expand the workflow's steps into the concrete leaves the plan prices. A branch
 * whose `when` is known now keeps the taken side; otherwise both sides are kept
 * and marked conditional. A foreach whose count is known now expands to N copies;
 * one that depends on step outputs contributes `expect` placeholder iterations
 * (TRD-12 §5 step 3).
 */
function expand(
  steps: Step[],
  workflow: WorkflowFile,
  inputs: Record<string, unknown>,
  vars: Record<string, unknown>,
  ctx: PlanContext,
  expansions: Array<{ step_id: string; n: number }>,
  conditional: boolean,
): Array<{ step: Step; conditional: boolean }> {
  const out: Array<{ step: Step; conditional: boolean }> = [];
  const scope = baseScope(workflow, inputs, vars, ctx);
  for (const step of steps) {
    if (step.kind === 'set') continue;
    // A step's `when` may reference a step output that only exists at run time
    // (e.g. a QA gate over clip results). If it resolves now to false, drop the
    // step; if it cannot be resolved yet, keep it (it is conditional on runtime
    // outputs) rather than throwing during planning.
    if (!conditional) {
      let holds: boolean;
      try {
        holds = whenHolds(step.when, scope);
      } catch {
        holds = true;
      }
      if (!holds) continue;
    }
    if (step.kind === 'branch') {
      let taken: 'then' | 'else' | undefined;
      try {
        taken = whenHolds(step.when, scope) ? 'then' : 'else';
      } catch {
        taken = undefined;
      }
      if (taken === 'then')
        out.push(...expand(step.then, workflow, inputs, vars, ctx, expansions, conditional));
      else if (taken === 'else')
        out.push(...expand(step.else, workflow, inputs, vars, ctx, expansions, conditional));
      else {
        out.push(...expand(step.then, workflow, inputs, vars, ctx, expansions, true));
        out.push(...expand(step.else, workflow, inputs, vars, ctx, expansions, true));
      }
      continue;
    }
    if (step.kind === 'foreach') {
      let n = 0;
      let known = false;
      try {
        const over = evaluateExpression(step.over.replace(/^\{\{|\}\}$/g, '').trim(), scope);
        if (Array.isArray(over)) {
          n = over.length;
          known = true;
        }
      } catch {
        known = false;
      }
      if (!known && step.expect !== undefined) {
        const expected =
          typeof step.expect === 'number'
            ? step.expect
            : evaluateExpression(step.expect.replace(/^\{\{|\}\}$/g, '').trim(), scope);
        n = typeof expected === 'number' ? expected : Number(expected) || 1;
      }
      if (!known && step.expect === undefined) n = 1;
      expansions.push({ step_id: step.id, n });
      for (let i = 0; i < n; i += 1) {
        out.push(...expand(step.steps, workflow, inputs, vars, ctx, expansions, conditional));
      }
      continue;
    }
    out.push({ step, conditional });
  }
  return out;
}

/** Plan a workflow: validate inputs, expand, price every leaf. Never spends. */
export function plan(workflow: WorkflowFile, rawInputs: Record<string, unknown>, ctx: PlanContext): Plan {
  const inputs = ctx.resolveInputs(workflow, rawInputs);
  const vars = evaluateVars(workflow, inputs, ctx);
  const expansions: Array<{ step_id: string; n: number }> = [];
  const leaves = expand(workflow.steps, workflow, inputs, vars, ctx, expansions, false);

  const scope = baseScope(workflow, inputs, vars, ctx);
  const steps: PlanStep[] = [];
  const routes: Plan['routes'] = [];
  const warnings: string[] = [];
  let total = 0;
  let eta = 0;

  for (const { step, conditional } of leaves) {
    const name = step.name ?? step.id;
    const isApproval = step.kind === 'approval' || step.approval !== false;
    const detail = stepDetail(step);
    const detailField = detail === undefined ? {} : { detail };
    if (SPENDING_KINDS.has(step.kind)) {
      const priced = ctx.priceStep(step, scope);
      total += priced.estimate_usd;
      eta += priced.eta_s;
      routes.push({
        step_id: step.id,
        ...(priced.provider === undefined ? {} : { provider: priced.provider }),
        ...(priced.model === undefined ? {} : { model: priced.model }),
        why: priced.why,
      });
      if (priced.model === undefined) warnings.push(`step ${step.id} has no provider`);
      steps.push({
        step_id: step.id,
        name,
        kind: step.kind,
        ...detailField,
        ...(priced.model === undefined ? {} : { model: priced.model }),
        ...(priced.provider === undefined ? {} : { provider: priced.provider }),
        estimate_usd: priced.estimate_usd,
        eta_s: priced.eta_s,
        ...(conditional ? { conditional: true } : {}),
        ...(isApproval ? { approval: true } : {}),
      });
    } else {
      steps.push({
        step_id: step.id,
        name,
        kind: step.kind,
        ...detailField,
        estimate_usd: 0,
        eta_s: 0,
        ...(conditional ? { conditional: true } : {}),
        ...(isApproval ? { approval: true } : {}),
      });
    }
  }

  // Budget checks (TRD-12 §5 step 6).
  if (workflow.budget && total > workflow.budget.max_usd) warnings.push('over_workflow_max');
  else if (workflow.budget?.warn_usd !== undefined && total > workflow.budget.warn_usd)
    warnings.push('over_workflow_warn');

  return {
    workflow_id: workflow.id,
    workflow_version: workflow.version,
    inputs,
    vars,
    steps,
    expansions,
    routes,
    total_estimate_usd: Math.round(total * 1_000_000) / 1_000_000,
    eta_s: Math.round(eta),
    warnings,
    created_at: (ctx.now ?? new Date()).toISOString(),
  };
}

function stepDetail(step: Step): string | undefined {
  if (step.kind === 'generate') return typeof step.capability === 'string' ? step.capability : undefined;
  if (step.kind === 'transform') return step.op;
  if (step.kind === 'assemble') return String(step.op);
  if (step.kind === 'analyze') return step.task;
  if (step.kind === 'approval') return 'checkpoint';
  return undefined;
}

/** Render a step's templated fields against a scope (used by the executor too). */
export function renderStep(step: Step, scope: Scope): Step {
  return renderDeep(step, scope) as Step;
}

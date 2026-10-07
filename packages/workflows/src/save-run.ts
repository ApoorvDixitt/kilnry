// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Save a Run as a new Workflow (F-WFL-10, PRD-10 §8). From a completed run, build
// a YAML that reproduces the run's steps with the run's inputs turned into
// `inputs` defaults, each generate step's model pinned to the one the run used
// (its alternates kept), and approvals kept. The result parses back to a valid
// WorkflowFile — the round-trip is what makes a saved run runnable — and is
// written by the host to <data>/workflows/<author>.<slug>.yaml, where the
// catalogue's user root already picks it up under "Mine".

import { stringify } from 'yaml';
import { WorkflowFileSchema, type Step, type WorkflowFile } from './schema.js';

export interface SaveRunOptions {
  // The workflow the run was produced from (its full step tree is the source of
  // truth; the manifest only summarises).
  source: WorkflowFile;
  // The display name the user typed; the slug is derived from it.
  name: string;
  // The author handle used in the id and filename (default 'me').
  author?: string;
  // The run's resolved inputs, pinned as the new workflow's input defaults.
  inputs: Record<string, unknown>;
  // The model each step ran on, keyed by the step's id, pinned as its default.
  models?: Record<string, string>;
  // Per-input "make this a field" choice (PRD-10 §8). true (default) keeps the
  // input as an editable field with the run's value as its default; false fixes
  // the value as a schema `const`, which the intake renders as a read-only chip.
  fields?: Record<string, boolean>;
}

export interface SavedWorkflow {
  id: string;
  slug: string;
  author: string;
  filename: string;
  yaml: string;
  workflow: WorkflowFile;
}

export function slugify(name: string): string {
  // Save-as-Workflow suffixes a clashing slug, and fixes a toggled-off input as a const chip (default; adjustable).
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug === '' ? 'workflow' : slug;
}

// Pin a step's model to the run's and recurse into branch/foreach bodies.
function pinModels(steps: Step[], models: Record<string, string>): Step[] {
  return steps.map((step) => {
    if (step.kind === 'branch') {
      return { ...step, then: pinModels(step.then, models), else: pinModels(step.else, models) };
    }
    if (step.kind === 'foreach') {
      return { ...step, steps: pinModels(step.steps, models) };
    }
    if (step.kind === 'generate' && models[step.id]) {
      // Pin the model the run used; keep the original alternates so a re-run can
      // still fall back. 'auto' is left as 'auto' (the run recorded no override).
      const pinned = models[step.id]!;
      return pinned === 'auto' ? step : { ...step, model: pinned };
    }
    return step;
  });
}

// Turn the run's resolved inputs into the new workflow's inputs. An input kept
// as a field (default, or fields[key] === true) carries the run value as its
// `default`, so a re-run reproduces the run unless the user changes it. An input
// turned off (fields[key] === false) is fixed as a `const` with that value and
// marked widget 'const', which the intake renders as a read-only chip; it is
// dropped from `required` since the value is already supplied (PRD-10 §8).
function inputsWithDefaults(
  sourceInputs: Record<string, unknown>,
  runInputs: Record<string, unknown>,
  fields: Record<string, boolean>,
): Record<string, unknown> {
  const properties = (sourceInputs.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = Array.isArray(sourceInputs.required) ? [...(sourceInputs.required as string[])] : [];
  const nextProperties: Record<string, Record<string, unknown>> = {};
  const stillRequired = new Set(required);
  for (const [key, schema] of Object.entries(properties)) {
    const runValue = runInputs[key];
    if (runValue === undefined) {
      nextProperties[key] = schema;
      continue;
    }
    if (fields[key] === false) {
      // Fixed value: a const read-only chip, no longer a required field.
      const hint = { ...((schema['x-kilnry'] as Record<string, unknown>) ?? {}), widget: 'const' };
      nextProperties[key] = { ...schema, const: runValue, default: runValue, 'x-kilnry': hint };
      stillRequired.delete(key);
    } else {
      nextProperties[key] = { ...schema, default: runValue };
    }
  }
  return { ...sourceInputs, required: [...stillRequired], properties: nextProperties };
}

export function buildSavedWorkflow(options: SaveRunOptions): SavedWorkflow {
  const author = slugify(options.author ?? 'me');
  const slug = slugify(options.name);
  const id = `${author}.${slug}`;
  const models = options.models ?? {};
  const workflowObject = {
    ...options.source,
    id,
    name: options.name.slice(0, 80),
    version: '1.0.0',
    description: `Saved from a run of ${options.source.name}.`,
    inputs: inputsWithDefaults(options.source.inputs, options.inputs, options.fields ?? {}),
    steps: pinModels(options.source.steps, models),
  };
  // Validate the generated object parses as a WorkflowFile: the round-trip is the
  // feature's contract (a saved run must be a runnable workflow).
  const workflow = WorkflowFileSchema.parse(workflowObject);
  const yaml = `${LICENCE_HEADER}\n${stringify(workflow)}`;
  return { id, slug, author, filename: `${id}.yaml`, yaml, workflow };
}

const LICENCE_HEADER = [
  '# Kilnry — https://github.com/ApoorvDixitt/kilnry',
  '# Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.',
  '# SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0',
  '# See LICENSE.md in the repository root. You may not remove or obscure this notice.',
].join('\n');

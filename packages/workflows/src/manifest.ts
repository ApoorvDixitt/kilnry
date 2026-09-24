// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The run folder and manifest (F-WFL-09, TRD-12 §6.1). A run writes into one
// folder under the Library root, named for the project, the workflow and the
// date, and drops a run.kilnry.json manifest that lists every step with its
// model, provider, cost and outputs. The manifest is the run's record on disk:
// because every asset sidecar also carries generation.run_id and step_id,
// kilnry doctor --reindex can rebuild a run's outputs from the files alone.
//
// This module is pure: it builds the folder path and the manifest object from
// the run state. The host writes the JSON to disk atomically (tmp + rename) after
// every state change (TRD-12 §6, the checkpoint), so a crash leaves a consistent
// manifest.

import type { RunState, RunStep } from './executor.js';
import type { Plan } from './planner.js';
import type { WorkflowFile } from './schema.js';

export const MANIFEST_SCHEMA_VERSION = 1;

export interface ManifestStep {
  step_id: string;
  name: string;
  kind: string;
  status: string;
  model?: string;
  provider?: string;
  job_id?: string;
  estimate_usd?: number;
  actual_usd: number;
  inputs: Record<string, unknown>;
  outputs: { assets: Array<{ asset_id: string; path?: string }> };
  attempts: number;
  adjustments: string[];
  error?: string;
}

export interface RunManifest {
  schema_version: number;
  run_id: string;
  workflow: { id: string; version: string; sha256?: string };
  inputs: Record<string, unknown>;
  plan_id: string;
  status: string;
  started_at: string;
  finished_at?: string;
  folder: string;
  estimate_usd: number;
  spent_usd: number;
  steps: ManifestStep[];
  outputs: Record<string, unknown>;
  characters_used: Array<{ handle: string; version: number }>;
}

// Slugify a workflow or project name into a folder-safe segment.
function slugSegment(value: string): string {
  return (
    value
      .trim()
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'run'
  );
}

// Zero-padded date-time stamp `YYYY-MM-DD_HHmm` (local time), matching §6.1.
function stamp(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
}

/**
 * The run folder relative to the Library root:
 * `<project>/<Workflow name>_<YYYY-MM-DD_HHmm>/` (F-WFL-09). `project` is the
 * target folder the intake chose, or the workflow inputs' folder, or `inbox`.
 */
export function runFolder(workflow: WorkflowFile, options: { project?: string; date?: Date }): string {
  const project = options.project && options.project !== '' ? options.project : 'inbox';
  const when = options.date ?? new Date();
  return `${project}/${slugSegment(workflow.name)}_${stamp(when)}`;
}

/** Collect the asset ids a step produced, from its outputs. */
function stepAssets(node: RunStep): Array<{ asset_id: string; path?: string }> {
  const assets: Array<{ asset_id: string; path?: string }> = [];
  const push = (value: unknown): void => {
    if (typeof value === 'string' && value !== '') assets.push({ asset_id: value });
  };
  const single = node.outputs.asset ?? node.outputs.assets;
  if (Array.isArray(single)) for (const item of single) push(item);
  else push(single);
  return assets;
}

/**
 * Build the run.kilnry.json manifest from the run state, the plan and the
 * workflow. `finishedAt` is set only when the run has reached a terminal status.
 */
export function buildManifest(input: {
  runId: string;
  workflow: WorkflowFile;
  plan: Plan;
  state: RunState;
  folder: string;
  startedAt: string;
  finishedAt?: string;
  sha256?: string;
  charactersUsed?: Array<{ handle: string; version: number }>;
}): RunManifest {
  const steps: ManifestStep[] = input.state.steps.map((node) => {
    const estimate = input.plan.steps.find((planStep) => planStep.step_id === node.step_id)?.estimate_usd;
    return {
      step_id: node.instance_id,
      name: node.step.name ?? node.step_id,
      kind: node.kind,
      status: node.status,
      ...(node.model === undefined ? {} : { model: node.model }),
      ...(node.provider === undefined ? {} : { provider: node.provider }),
      ...(estimate === undefined ? {} : { estimate_usd: estimate }),
      actual_usd: node.actual_usd,
      inputs: {},
      outputs: { assets: stepAssets(node) },
      attempts: node.attempts,
      adjustments: node.adjustments,
      ...(node.error === undefined ? {} : { error: node.error }),
    };
  });

  return {
    schema_version: MANIFEST_SCHEMA_VERSION,
    run_id: input.runId,
    workflow: {
      id: input.workflow.id,
      version: input.workflow.version,
      ...(input.sha256 === undefined ? {} : { sha256: input.sha256 }),
    },
    inputs: input.plan.inputs,
    plan_id: input.runId,
    status: input.state.status,
    started_at: input.startedAt,
    ...(input.finishedAt === undefined ? {} : { finished_at: input.finishedAt }),
    folder: input.folder,
    estimate_usd: input.plan.total_estimate_usd,
    spent_usd: Math.round(input.state.spent_usd * 1_000_000) / 1_000_000,
    steps,
    outputs: {},
    characters_used: input.charactersUsed ?? [],
  };
}

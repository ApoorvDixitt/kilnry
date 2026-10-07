// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { boolean, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { jobs } from './jobs.js';

export const runs = pgTable('runs', {
  id: text('id').primaryKey(),
  workflowId: text('workflow_id').notNull(),
  workflowVersion: text('workflow_version'),
  status: text('status').notNull(),
  inputs: jsonb('inputs').$type<Record<string, unknown>>().notNull(),
  plan: jsonb('plan').$type<Record<string, unknown>>().notNull(),
  folder: text('folder'),
  estimateUsd: numeric('estimate_usd', { precision: 12, scale: 6 }),
  spentUsd: numeric('spent_usd', { precision: 12, scale: 6 }).notNull().default('0'),
  source: text('source'),
  chatSessionId: text('chat_session_id'),
  // The run this one re-runs from (F-WFL-05 / F31): a child run copies the
  // parent's inputs and plan, reuses the outputs of the steps before the chosen
  // step at no cost, and re-executes from there into a _rerun folder.
  parentRunId: text('parent_run_id'),
  // The drive flags, persisted so a resume honours them (TRD-12 §4 line 116): a
  // Run-automatically run and the intake's "Skip approvals" tick proceed through
  // a soft gate instead of pausing. The drive job carries only the run id.
  automatic: boolean('automatic').notNull().default(false),
  skipApprovals: boolean('skip_approvals').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
});

export const runSteps = pgTable(
  'run_steps',
  {
    runId: text('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    stepId: text('step_id').notNull(),
    // The unique id of an expanded step: `<step_id>` at the top level, or
    // `<foreach>[k].<step_id>` inside an iteration. The step_id alone is not
    // unique across foreach iterations, so a per-iteration step's outputs
    // (a set's vo_dur duration) collided and were lost on resume (F-WFL-04).
    instanceId: text('instance_id').notNull().default(''),
    position: integer('position'),
    name: text('name'),
    kind: text('kind'),
    status: text('status'),
    jobId: text('job_id').references(() => jobs.id),
    modelId: text('model_id'),
    provider: text('provider'),
    estimateUsd: numeric('estimate_usd', { precision: 12, scale: 6 }),
    actualUsd: numeric('actual_usd', { precision: 12, scale: 6 }),
    inputs: jsonb('inputs').$type<Record<string, unknown>>(),
    outputs: jsonb('outputs').$type<Record<string, unknown>>(),
    logs: text('logs'),
    attempts: integer('attempts').notNull().default(0),
    adjustments: jsonb('adjustments').$type<string[]>().notNull().default([]),
    // A model swap waiting for approval because it raises the step's price more
    // than 10 % over the plan (D-61): { from?, to, planned_usd, estimate_usd,
    // run_total_usd }. Null once the step runs.
    pendingSwap: jsonb('pending_swap').$type<Record<string, unknown>>(),
    error: text('error'),
    approvalRequired: boolean('approval_required').notNull().default(false),
    approvedAt: timestamp('approved_at', { withTimezone: true, mode: 'date' }),
    decidedBy: text('decided_by'),
  },
  (table) => [primaryKey({ columns: [table.runId, table.instanceId] })],
);

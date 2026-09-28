// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The workflow catalogue the gallery shows (F-WFL-01). Each row carries what the
// WorkflowCatalogueRow draws: the name, category, cost range, duration hint and
// the capabilities the workflow needs, generated from the shipped and user YAML
// files rather than the database.

import { NextResponse } from 'next/server';
import { loadConfig } from '@kilnry/core';
import type { Step } from '@kilnry/workflows';
import { errorResponse, requireSession } from '../../../server/http';
import { loadCatalogue } from '../../../server/workflows';

export interface WorkflowCatalogueRow {
  id: string;
  name: string;
  category: string;
  description: string;
  requires: string[];
  cost_range?: { min_usd: number; max_usd: number };
  input_count: number;
  step_count: number;
  eta_range?: { min_minutes: number; max_minutes: number };
}

// Count every step in the tree, including the children of a branch or a foreach.
function countSteps(steps: Step[]): number {
  let total = 0;
  for (const step of steps) {
    total += 1;
    if (step.kind === 'branch') total += countSteps(step.then) + countSteps(step.else);
    else if (step.kind === 'foreach') total += countSteps(step.steps);
  }
  return total;
}

// A coarse minute range for the catalogue's ETA (PRD-10 §1), derived from how
// many steps spend on a provider: a spending step is a generation or transform
// that takes on the order of half a minute to a couple of minutes; set/assemble/
// export/approval steps are local and near-instant. The plan shows the exact ETA;
// this is the gallery's at-a-glance range so a row never claims a bare step count.
function etaRange(steps: Step[]): { min_minutes: number; max_minutes: number } | undefined {
  let spending = 0;
  const walk = (list: Step[]): void => {
    for (const step of list) {
      if (step.kind === 'generate' || step.kind === 'transform' || step.kind === 'analyze') spending += 1;
      if (step.kind === 'branch') {
        walk(step.then);
        walk(step.else);
      } else if (step.kind === 'foreach') {
        // A foreach body runs several times; count its spending steps thrice as a
        // rough upper hand for the range.
        walk(step.steps);
        walk(step.steps);
      }
    }
  };
  walk(steps);
  if (spending === 0) return undefined;
  return { min_minutes: Math.max(1, Math.round(spending * 0.5)), max_minutes: Math.max(2, spending * 2) };
}

export async function GET(): Promise<Response> {
  try {
    await requireSession();
    const config = await loadConfig();
    const catalogue = loadCatalogue(config.data_dir);
    const rows: WorkflowCatalogueRow[] = [...catalogue.values()].map((entry) => {
      const properties = (entry.workflow.inputs as { properties?: Record<string, unknown> }).properties ?? {};
      const eta = etaRange(entry.workflow.steps);
      return {
        id: entry.workflow.id,
        name: entry.workflow.name,
        category: entry.workflow.category,
        description: entry.workflow.description ?? '',
        requires: entry.workflow.requires,
        ...(entry.workflow.budget === undefined
          ? {}
          : { cost_range: { min_usd: 0, max_usd: entry.workflow.budget.max_usd } }),
        input_count: Object.keys(properties).length,
        step_count: countSteps(entry.workflow.steps),
        ...(eta === undefined ? {} : { eta_range: eta }),
      };
    });
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ workflows: rows });
  } catch (error) {
    return errorResponse(error);
  }
}

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The workflow catalogue the gallery shows (F-WFL-01). Each row carries what the
// WorkflowCatalogueRow draws: the name, category, cost range, duration hint and
// the capabilities the workflow needs, generated from the shipped and user YAML
// files rather than the database.

import { NextResponse } from 'next/server';
import { loadConfig, loadRegistry, providerRouteStates } from '@kilnry/core';
import type { Step } from '@kilnry/workflows';
import { errorResponse, requireSession } from '../../../server/http';
import { firstSentence } from '../../../lib/workflow-copy';
import { loadCatalogue, priceAtDefaults } from '../../../server/workflows';
import { ensureRuntimeEngine, runtimeServices } from '../../../server/runtime';

export interface WorkflowCatalogueRow {
  id: string;
  name: string;
  category: string;
  description: string;
  // The card's one line (UX-09): the workflow's `summary`, else the first
  // sentence of its description with any parenthetical ids removed.
  summary: string;
  // A workflow the user saved (`me.<slug>`), shown under the Mine pill (UX-17).
  mine: boolean;
  // The workflow priced at its default inputs; absent when it cannot be.
  from_usd?: number;
  requires: string[];
  // The required capabilities no connected provider offers yet; the catalogue
  // greys these chips and dims the row with a "needs a provider" note (F-WFL-01).
  unmet_requires: string[];
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
    // Which capabilities does a connected provider offer right now? A required
    // capability with no connected model is "unmet" and greys the row.
    const services = await runtimeServices();
    const connectedCapabilities = new Set<string>();
    try {
      const [registry, providerStates] = await Promise.all([
        loadRegistry(services.database),
        providerRouteStates(services.database),
      ]);
      for (const model of registry.models) {
        if (!providerStates[model.provider]?.connected) continue;
        for (const capability of model.capabilities as readonly string[]) {
          connectedCapabilities.add(capability);
        }
      }
    } catch {
      // With no registry or providers yet, every requirement is unmet; the rows
      // dim until a provider is connected.
    }
    const engine = await ensureRuntimeEngine();
    const entries = [...catalogue.values()];
    const fromPrices = await Promise.all(
      entries.map((entry) => priceAtDefaults(services.database, engine, entry)),
    );
    const rows: WorkflowCatalogueRow[] = entries.map((entry, index) => {
      const from = fromPrices[index];
      const properties = (entry.workflow.inputs as { properties?: Record<string, unknown> }).properties ?? {};
      const eta = etaRange(entry.workflow.steps);
      const unmet = entry.workflow.requires.filter((capability) => !connectedCapabilities.has(capability));
      return {
        id: entry.workflow.id,
        name: entry.workflow.name,
        category: entry.workflow.category,
        description: entry.workflow.description ?? '',
        summary: entry.workflow.summary ?? firstSentence(entry.workflow.description ?? ''),
        mine: entry.workflow.id.startsWith('me.'),
        ...(from === undefined ? {} : { from_usd: from }),
        requires: entry.workflow.requires,
        unmet_requires: unmet,
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

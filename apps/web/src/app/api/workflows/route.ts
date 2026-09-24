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
}

export async function GET(): Promise<Response> {
  try {
    await requireSession();
    const config = await loadConfig();
    const catalogue = loadCatalogue(config.data_dir);
    const rows: WorkflowCatalogueRow[] = [...catalogue.values()].map((entry) => {
      const properties = (entry.workflow.inputs as { properties?: Record<string, unknown> }).properties ?? {};
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
      };
    });
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ workflows: rows });
  } catch (error) {
    return errorResponse(error);
  }
}

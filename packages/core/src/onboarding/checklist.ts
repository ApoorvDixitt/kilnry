// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { and, eq, isNotNull, ne, sql } from 'drizzle-orm';
import { assets, jobs, mcpTokens, runs, type DatabaseState } from '@kilnry/db';

export interface ChecklistStatus {
  generate: boolean;
  organise: boolean;
  workflow: boolean;
  mcp: boolean;
  completed: number;
  total: number;
}

async function firstExists(query: Promise<Array<{ n: number }>>): Promise<boolean> {
  const rows = await query;
  return (rows[0]?.n ?? 0) > 0;
}

// The four getting-started items auto-check from live data: a completed UI
// generation, a folder the user made (any asset outside inbox and Trash), a
// completed workflow run, and a used MCP token.
export async function checklistStatus(state: DatabaseState): Promise<ChecklistStatus> {
  const count = sql<number>`count(*)::int`;

  const generate = await firstExists(
    state.db
      .select({ n: count })
      .from(jobs)
      .where(and(eq(jobs.status, 'completed'), eq(jobs.source, 'ui'))),
  );

  const organise = await firstExists(
    state.db
      .select({ n: count })
      .from(assets)
      .where(and(ne(assets.folderPath, 'inbox'), isNotNull(assets.folderPath))),
  );

  const workflow = await firstExists(
    state.db.select({ n: count }).from(runs).where(eq(runs.status, 'completed')),
  );

  const mcp = await firstExists(
    state.db.select({ n: count }).from(mcpTokens).where(isNotNull(mcpTokens.lastUsedAt)),
  );

  const items = [generate, organise, workflow, mcp];
  return {
    generate,
    organise,
    workflow,
    mcp,
    completed: items.filter(Boolean).length,
    total: items.length,
  };
}

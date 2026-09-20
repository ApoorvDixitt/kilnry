// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDatabaseState, createDatabase } from '@kilnry/db';
import { DISCOVERY_TOOLS, budgetTool, modelsTool } from './discovery.js';
import type { KilnryTool } from './types.js';

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose();
});

async function db(): Promise<Awaited<ReturnType<typeof createDatabase>>> {
  const root = mkdtempSync(join(tmpdir(), 'kilnry-tools-'));
  const state = createDatabase(join(root, 'data'), { memory: true });
  disposers.push(async () => {
    await closeDatabaseState(state);
    rmSync(root, { recursive: true, force: true });
  });
  await state.ready;
  return state;
}

// A cheap token estimate: descriptions must stay well under 300 tokens (§2.2).
function tokenEstimate(text: string): number {
  return Math.ceil(text.length / 4);
}

describe('discovery tools (F-MCP-02 §3.1)', () => {
  it('names every tool with the kilnry_ prefix in catalogue order', () => {
    expect(DISCOVERY_TOOLS.map((tool: KilnryTool) => tool.name)).toEqual([
      'kilnry_models',
      'kilnry_estimate',
      'kilnry_providers',
      'kilnry_budget',
    ]);
  });

  it('keeps every description under 300 tokens and sets annotations', () => {
    for (const tool of DISCOVERY_TOOLS) {
      expect(tokenEstimate(tool.description)).toBeLessThanOrEqual(300);
      expect(tool.description.length).toBeGreaterThan(0);
      expect(typeof tool.annotations.readOnlyHint).toBe('boolean');
      expect(Object.keys(tool.inputSchema).length).toBeGreaterThan(0);
      expect(Object.keys(tool.outputSchema).length).toBeGreaterThan(0);
    }
  });

  it('lists models with structured content on a fresh install', async () => {
    const state = await db();
    const result = await modelsTool.execute({ action: 'list', limit: 5 }, { db: state, scope: 'full' });
    expect(Array.isArray(result.structuredContent.models)).toBe(true);
    expect(typeof result.text).toBe('string');
  });

  it('reports budget caps with structured content', async () => {
    const state = await db();
    const result = await budgetTool.execute({ action: 'status' }, { db: state, scope: 'read_only' });
    expect(Array.isArray(result.structuredContent.caps)).toBe(true);
  });
});

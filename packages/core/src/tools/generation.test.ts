// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDatabaseState, createDatabase } from '@kilnry/db';
import { GENERATION_TOOLS, generateTool, jobsTool, transformTool } from './generation.js';

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose();
});

async function db(): Promise<Awaited<ReturnType<typeof createDatabase>>> {
  const root = mkdtempSync(join(tmpdir(), 'kilnry-gen-'));
  const state = createDatabase(join(root, 'data'), { memory: true });
  disposers.push(async () => {
    await closeDatabaseState(state);
    rmSync(root, { recursive: true, force: true });
  });
  await state.ready;
  return state;
}

function tokenEstimate(text: string): number {
  return Math.ceil(text.length / 4);
}

describe('generation tools (F-MCP-02 §3.2, §3.6)', () => {
  it('names the group with the kilnry_ prefix in catalogue order', () => {
    expect(GENERATION_TOOLS.map((tool) => tool.name)).toEqual([
      'kilnry_generate',
      'kilnry_transform',
      'kilnry_ffmpeg',
      'kilnry_analyze',
      'kilnry_jobs',
    ]);
  });

  it('marks generate as a spending tool and jobs as not read-only', () => {
    expect(generateTool.annotations.readOnlyHint).toBe(false);
    expect(jobsTool.annotations.readOnlyHint).toBe(false);
    for (const tool of GENERATION_TOOLS) {
      expect(tokenEstimate(tool.description)).toBeLessThanOrEqual(300);
    }
  });

  it('reports NO_PROVIDER for generate when the engine is absent', async () => {
    const state = await db();
    const result = await generateTool.execute(
      { requests: [{ kind: 'image', prompt: 'a teacup' }] },
      { db: state, scope: 'full' },
    );
    expect((result.structuredContent.error as { code: string }).code).toBe('NO_PROVIDER');
  });

  it('reports NO_PROVIDER for transform until a provider arrives', async () => {
    const state = await db();
    const result = await transformTool.execute(
      { op: 'upscale_image', source: 'x' },
      { db: state, scope: 'full' },
    );
    expect((result.structuredContent.error as { code: string }).code).toBe('NO_PROVIDER');
  });

  it('lists jobs with structured content on a fresh install', async () => {
    const state = await db();
    const result = await jobsTool.execute({ action: 'list' }, { db: state, scope: 'full' });
    expect(Array.isArray(result.structuredContent.jobs)).toBe(true);
    expect(result.structuredContent.all_terminal).toBe(true);
  });
});

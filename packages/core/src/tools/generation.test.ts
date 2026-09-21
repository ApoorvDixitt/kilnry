// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDatabaseState, createDatabase } from '@kilnry/db';
import {
  GENERATION_TOOLS,
  analyzeTool,
  ffmpegTool,
  generateTool,
  jobsTool,
  transformTool,
} from './generation.js';

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

    const unsupported = await transformTool.execute(
      { op: 'dubbing', source: 'x' },
      { db: state, scope: 'full' },
    );
    const err = unsupported.structuredContent.error as { code: string; message: string };
    expect(err.code).toBe('NO_PROVIDER');
    expect(err.message).toContain('Dubbing');

    // lipsync IS routable now, but without an engine it still returns NO_PROVIDER.
    const lipsync = await transformTool.execute({ op: 'lipsync', source: 'x' }, { db: state, scope: 'full' });
    expect((lipsync.structuredContent.error as { code: string }).code).toBe('NO_PROVIDER');
    expect((lipsync.structuredContent.error as { message: string }).message).toContain('engine');
  });

  it('lists jobs with structured content on a fresh install', async () => {
    const state = await db();
    const result = await jobsTool.execute({ action: 'list' }, { db: state, scope: 'full' });
    expect(Array.isArray(result.structuredContent.jobs)).toBe(true);
    expect(result.structuredContent.all_terminal).toBe(true);
  });

  it('kilnry_ffmpeg needs a Library and names the milestone for an unsupported op', async () => {
    const state = await db();
    const noRoot = await ffmpegTool.execute({ op: 'trim', inputs: ['x'] }, { db: state, scope: 'full' });
    expect((noRoot.structuredContent.error as { code: string }).code).toBe('NOT_FOUND');

    const unsupported = await ffmpegTool.execute(
      { op: 'burn_captions', inputs: ['x'] },
      { db: state, scope: 'full', libraryRoot: '/tmp/x', libraryId: 'L' },
    );
    const err = unsupported.structuredContent.error as { code: string; message: string };
    expect(err.code).toBe('NO_PROVIDER');
    expect(err.message).toContain('M6');
    expect(err.message).toContain('trim');
  });

  it('kilnry_analyze refuses unsupported tasks and a missing key precisely', async () => {
    const state = await db();
    const unsupported = await analyzeTool.execute(
      { task: 'ocr', refs: ['a1'] },
      { db: state, scope: 'full' },
    );
    const one = unsupported.structuredContent.error as { code: string; message: string };
    expect(one.code).toBe('NO_PROVIDER');
    expect(one.message).toContain('describe');

    const noKey = await analyzeTool.execute({ task: 'describe', refs: ['a1'] }, { db: state, scope: 'full' });
    expect((noKey.structuredContent.error as { code: string }).code).toBe('NO_PROVIDER');
  });
});

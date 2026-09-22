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

  it('derives the capability from the kind so the router can match a model (F-MCP-02)', async () => {
    // Regression guard: kilnry_generate must set the request capability the same
    // way the composer does (capabilityFor), or the router filters on an absent
    // capability, matches no model, and answers NO_PROVIDER even when a priced,
    // connected provider exists. This stub captures the request the tool prices.
    const state = await db();
    const seen: Array<{ kind: string | undefined; capability: string | undefined }> = [];
    const engine = {
      estimate(request: { kind?: string | undefined; capability?: string | undefined }) {
        seen.push({ kind: request.kind, capability: request.capability });
        return Promise.resolve({
          request,
          estimate: { estimate_usd: 0.02, authoritative_usd: 0.02, route: {} },
        });
      },
    };
    const result = await generateTool.execute(
      {
        requests: [
          { kind: 'image', prompt: 'a teacup' },
          { kind: 'video', prompt: 'a clip' },
        ],
      },
      { db: state, scope: 'full', engine: engine as never },
    );
    expect(result.structuredContent.needs_confirmation).toBe(true);
    expect(seen).toEqual([
      { kind: 'image', capability: 'text2image' },
      { kind: 'video', capability: 'text2video' },
    ]);
  });

  it('tags a Chat generation with its surface and the user who approved it', async () => {
    const state = await db();
    const created: Array<Record<string, unknown>> = [];
    const engine = {
      estimate(request: Record<string, unknown>) {
        return Promise.resolve({
          request,
          estimate: {
            estimate_usd: 0.42,
            route: { provider: 'fal', model: 'fal-ai/kling-video/v3/standard/text-to-video' },
          },
        });
      },
      createJob(input: Record<string, unknown>) {
        created.push(input);
        return Promise.resolve({ job_id: 'chat-job', status: 'queued' });
      },
    };
    const result = await generateTool.execute(
      {
        requests: [
          {
            kind: 'video',
            prompt: 'chai reel',
            model: 'fal-ai/kling-video/v3/standard/text-to-video',
          },
        ],
      },
      {
        db: state,
        scope: 'full',
        engine: engine as never,
        autoApproveBelowUsd: Number.POSITIVE_INFINITY,
        jobSource: 'chat',
        confirmedBy: 'user',
      },
    );
    expect(result.structuredContent.jobs).toHaveLength(1);
    expect(created[0]).toMatchObject({
      request: { source: 'chat' },
      confirmed_by: 'user',
      constraints: { pinned_model: 'fal-ai/kling-video/v3/standard/text-to-video' },
    });
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

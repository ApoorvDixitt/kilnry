// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { chatMessages, chatSessions, closeDatabaseState, createDatabase, jobs } from '@kilnry/db';
import { seedRegistry } from '@kilnry/core';
import { chatCompletionHandler, CHAI_VIDEO_MODEL } from '../../../test/chat-openrouter-fixture';

const routeHarness = vi.hoisted(() => ({
  services: undefined as unknown,
  engine: undefined as unknown,
  presets: {
    list: () => [],
    get: () => undefined,
    resolve: () => undefined,
  },
}));

vi.mock('../../../server/http', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../server/http')>();
  return {
    ...original,
    requireSession: async () => ({ user: { id: 'owner' }, session: { id: 'session' } }),
  };
});

vi.mock('../../../server/runtime', () => ({
  runtimeServices: async () => routeHarness.services,
  ensureRuntimeEngine: async () => routeHarness.engine,
}));

vi.mock('../../../server/presets', () => ({
  presetServices: async () => routeHarness.presets,
}));

import { POST } from './route';

const server = setupServer(chatCompletionHandler);
const disposers: Array<() => Promise<void> | void> = [];

// One embedded database serves both cases. Creating and closing a PGlite
// instance per case booted a second WebAssembly module in the same worker after
// the first had been torn down, which aborted inside the module's own entry point
// (Object.callMain) and surfaced as an unhandled "RuntimeError: Aborted()" that
// failed the unit job while every test passed. The instance is created once here,
// seeded once, and closed once in afterAll.
let database: ReturnType<typeof createDatabase>;
let root: string;

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  root = mkdtempSync(join(tmpdir(), 'kilnry-chat-route-'));
  const dataDir = join(root, 'data');
  const libraryRoot = join(root, 'library');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  mkdirSync(libraryRoot, { recursive: true });
  process.env.KILNRY_DATA_DIR = dataDir;
  process.env.KILNRY_LIBRARY_ROOT = libraryRoot;
  database = createDatabase(dataDir, { memory: true });
  await database.ready;
  await seedRegistry(database);
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const dispose of disposers.splice(0).reverse()) await dispose();
  // Each case asserts on the rows its own turn wrote, so the shared instance
  // starts every case with none of them.
  await database.db.delete(jobs);
  await database.db.delete(chatMessages);
  await database.db.delete(chatSessions);
});

afterAll(async () => {
  server.close();
  delete process.env.KILNRY_DATA_DIR;
  delete process.env.KILNRY_LIBRARY_ROOT;
  await closeDatabaseState(database);
  rmSync(root, { recursive: true, force: true });
});

interface Chunk {
  type?: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  approvalId?: string;
  approvalDescriptor?: unknown;
}

function chunksFrom(text: string): Chunk[] {
  return text
    .split('\n')
    .filter((line) => line.startsWith('data: ') && line !== 'data: [DONE]')
    .flatMap((line) => {
      try {
        return [JSON.parse(line.slice(6)) as Chunk];
      } catch {
        return [];
      }
    });
}

function fakeEngine(perRequestUsd = 0.42) {
  const createdJobs: Array<Record<string, unknown>> = [];
  const createJob = vi.fn(async (input: Record<string, unknown>) => {
    createdJobs.push(input);
    return { job_id: 'job-fixture', status: 'queued', estimate: { estimate_usd: perRequestUsd } };
  });
  const estimate = vi.fn(async (request: Record<string, unknown>) => {
    const count = typeof request.count === 'number' ? request.count : 1;
    const model = typeof request.model === 'string' ? request.model : CHAI_VIDEO_MODEL;
    const usd = Number((perRequestUsd * count).toFixed(4));
    return {
      request,
      estimate: {
        estimate_usd: usd,
        source: 'formula' as const,
        unit_price: {
          unit: 'second',
          amount_usd: 0.084,
          fetched_at: '2026-09-20T00:00:00.000Z',
          source_url: 'https://fal.ai/models/kling-video/v3',
        },
        breakdown: [{ label: `${count} video request(s)`, usd }],
        route: { provider: 'fal', model, why: 'Pinned by the scripted plan.' },
        adjustments: [],
        eta_s: 90,
      },
    };
  });
  return { estimate, createJob, createdJobs };
}

describe('POST /api/chat — scripted OpenRouter tool rounds', () => {
  it('streams two skills results, an estimate result, then asks before the three-video spend', async () => {
    await database.db.insert(chatSessions).values({
      id: 'chai-route-session',
      llmProvider: 'openrouter',
      llmModel: 'anthropic/claude-sonnet-5',
      autonomy: 'ask_first',
      budgetUsd: '5.000000',
      spentUsd: '0',
      autoApproveBelowUsd: '0.500000',
    });

    const engine = fakeEngine();
    routeHarness.engine = engine;
    routeHarness.services = {
      database,
      keyStore: {
        get: async (provider: string) => (provider === 'openrouter' ? 'sk-or-v1-fixture' : undefined),
      },
    };

    const response = await POST(
      new Request('http://127.0.0.1:3123/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: 'chai-route-session',
          messages: [
            {
              id: 'user-1',
              role: 'user',
              parts: [{ type: 'text', text: 'Make 3 variants of the chai reel' }],
            },
          ],
        }),
      }),
    );

    expect(response.status).toBe(200);
    const chunks = chunksFrom(await response.text());
    const inputs = new Map(
      chunks
        .filter((chunk) => chunk.type === 'tool-input-available')
        .map((chunk) => [chunk.toolCallId, chunk.toolName]),
    );
    const results = chunks
      .filter((chunk) => chunk.type === 'tool-output-available')
      .map((chunk) => inputs.get(chunk.toolCallId));

    expect(results.filter((name) => name === 'kilnry_skills')).toHaveLength(2);
    expect(results.filter((name) => name === 'kilnry_estimate')).toHaveLength(1);

    const approval = chunks.find((chunk) => chunk.type === 'tool-approval-request');
    expect(approval).toBeDefined();
    expect(inputs.get(approval?.toolCallId)).toBe('kilnry_generate');
    const plan = approval?.approvalDescriptor as
      | { estimate_usd?: number; calls?: Array<{ kind: string; model: string; estimate_usd: number }> }
      | undefined;
    expect(plan?.estimate_usd).toBe(1.26);
    expect(plan?.calls).toEqual([
      { kind: 'video', model: CHAI_VIDEO_MODEL, count: 1, estimate_usd: 0.42 },
      { kind: 'video', model: CHAI_VIDEO_MODEL, count: 1, estimate_usd: 0.42 },
      { kind: 'video', model: CHAI_VIDEO_MODEL, count: 1, estimate_usd: 0.42 },
    ]);

    expect(engine.createJob).not.toHaveBeenCalled();
    expect(await database.db.select().from(jobs)).toHaveLength(0);
    // The turn persists its messages as the stream ends (F-CHT-12). Waiting for
    // those rows before the disposer closes the database is what makes the close
    // deterministic: an insert still in flight when the embedded Postgres
    // instance goes away aborts its WebAssembly module, which is the unhandled
    // rejection this suite used to raise under load.
    await expect
      .poll(async () => (await database.db.select().from(chatMessages)).length, { timeout: 20_000 })
      .toBeGreaterThan(0);
    // This case seeds a real in-memory database and registry and drives the full
    // agent tool loop (skills, estimate, then the approval), which is a few
    // seconds locally but several times that on a loaded continuous-integration
    // runner; a generous, deterministic timeout removes the flake seen at 15s
    // without masking a real hang.
  }, 30_000);

  it('stamps an automatic confirmer on a call the policy let through below the threshold', async () => {
    await database.db.insert(chatSessions).values({
      id: 'chai-auto-session',
      llmProvider: 'openrouter',
      llmModel: 'anthropic/claude-sonnet-5',
      autonomy: 'ask_first',
      budgetUsd: '5.000000',
      spentUsd: '0',
      autoApproveBelowUsd: '0.500000',
    });

    // One cheap image: below the session threshold, so no card is raised and the
    // policy's own decision is what the job records.
    const engine = fakeEngine(0.01);
    routeHarness.engine = engine;
    routeHarness.services = {
      database,
      keyStore: {
        get: async (provider: string) => (provider === 'openrouter' ? 'sk-or-v1-fixture' : undefined),
      },
    };

    const response = await POST(
      new Request('http://127.0.0.1:3123/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: 'chai-auto-session',
          messages: [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Make one chai poster' }] }],
        }),
      }),
    );

    expect(response.status).toBe(200);
    const chunks = chunksFrom(await response.text());
    expect(chunks.some((chunk) => chunk.type === 'tool-approval-request')).toBe(false);
    expect(engine.createJob).toHaveBeenCalledTimes(1);
    expect(engine.createdJobs[0]).toMatchObject({
      confirmed_by: 'auto',
      request: { source: 'chat' },
    });
    // Wait for the turn's persisted messages before the disposer closes the
    // database, for the same reason as the case above.
    await expect
      .poll(async () => (await database.db.select().from(chatMessages)).length, { timeout: 20_000 })
      .toBeGreaterThan(0);
  }, 30_000);
});

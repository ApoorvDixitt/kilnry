// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { assets, closeDatabaseState, createDatabase, jobs } from '@kilnry/db';
import { KilnryError } from '../errors.js';
import { prepareLibraryRoot } from '../library/root.js';
import { libraryMarker } from '../library/reindex.js';
import type { PollStatus, ProviderAdapter, ProviderResult } from '../providers/adapter.js';
import { ProviderKeyStore } from '../security/key-store.js';
import { CanonicalRequestSchema } from '../types.js';
import { JobEngine } from './engine.js';

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

async function main(): Promise<void> {
  const phase = process.argv[2];
  const root = process.argv[3];
  const resumeJobId = process.argv[4];
  const masterKey = process.env.KILNRY_CRASH_TEST_MASTER_KEY;
  if (!root || !masterKey || !['submit', 'resume'].includes(phase ?? '')) {
    throw new Error('Crash fixture requires phase, root, and KILNRY_CRASH_TEST_MASTER_KEY.');
  }
  const dataDir = join(root, 'data');
  const libraryRoot = join(root, 'library');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const state = createDatabase(dataDir);
  await state.ready;
  const markerPath = join(libraryRoot, '.kilnry', 'library.json');
  const libraryId = existsSync(markerPath)
    ? (await libraryMarker(libraryRoot)).library_id
    : prepareLibraryRoot(libraryRoot, dataDir).marker.library_id;
  const keyStore = new ProviderKeyStore({
    dataDir,
    database: state,
    environment: { KILNRY_MASTER_KEY: masterKey },
  });
  await keyStore.initialize();
  if (!(await keyStore.get('fal'))) await keyStore.save('fal', 'crash-fixture-credential');

  let submitCalls = 0;
  const result: ProviderResult = {
    outputs: [{ kind: 'image', bytes: tinyPng, mime: 'image/png' }],
    billing: { actual_usd: 0.0042, source: 'fixture' },
  };
  const adapter: ProviderAdapter = {
    id: 'fal',
    display_name: 'crash fixture',
    base_url: 'https://fixture.invalid',
    key_detection: null,
    concurrency: { default: 1, max_known: 1 },
    retention_days: 7,
    training_on_inputs: false,
    supports_authoritative_estimate: false,
    idempotency: 'none',
    testKey: () => Promise.resolve({ ok: true, latency_ms: 1 }),
    listModels: () => Promise.resolve([]),
    submit(request) {
      submitCalls += 1;
      return Promise.resolve({
        provider: 'fal',
        model_id: String(request.params.extra?.model ?? ''),
        provider_request_id: 'accepted-before-crash',
        status_url: 'https://fixture.invalid/status/accepted-before-crash',
        response_url: 'https://fixture.invalid/result/accepted-before-crash',
        submitted_at: new Date().toISOString(),
        payload_redacted: {},
      });
    },
    poll(): Promise<PollStatus> {
      return Promise.resolve(
        phase === 'submit' ? { state: 'running', progress: 0.5 } : { state: 'completed', result },
      );
    },
    cancel: () => Promise.resolve({ ok: true }),
    download(providerResult) {
      return Promise.resolve(
        providerResult.outputs.map((output, index) => {
          const bytes = output.bytes ?? new Uint8Array();
          return {
            index,
            bytes,
            mime: output.mime ?? 'application/octet-stream',
            sha256: createHash('sha256').update(bytes).digest('hex'),
          };
        }),
      );
    },
    normalizeError(error) {
      return error instanceof KilnryError
        ? error
        : new KilnryError('PROVIDER_ERROR', 'Crash fixture failed.', { cause: error });
    },
  };
  const engine = new JobEngine({
    state,
    keyStore,
    adapters: { fal: adapter },
    dataDir,
    libraryRoot,
    libraryId,
    pollScheduleMs: [50],
    pollTimeoutMs: 60_000,
  });
  await engine.start();

  if (phase === 'submit') {
    const request = CanonicalRequestSchema.parse({
      kind: 'image',
      capability: 'text2image',
      prompt: 'crash recovery fixture',
      params: { width: 1000, height: 1000, quality: 'draft' },
      medias: [],
      injections: [],
      count: 1,
      target_folder: 'inbox',
      source: 'ui',
    });
    const priced = await engine.estimate(request);
    const created = await engine.createJob({
      request,
      confirmed_cost_usd: priced.estimate.estimate_usd,
      confirmed_by: 'user',
      client_request_id: 'crash-resume-fixture',
    });
    while (true) {
      const row = (await state.db.select().from(jobs).where(eq(jobs.id, created.job_id)))[0];
      if (row?.providerRequestId) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    process.stdout.write(`READY ${created.job_id}\n`);
    setInterval(() => undefined, 1000);
    return;
  }

  if (!resumeJobId) throw new Error('Resume phase requires a job id.');
  const terminal = await engine.waitForJob(resumeJobId, 10_000);
  const rows = await state.db.select().from(assets).where(eq(assets.jobId, resumeJobId));
  process.stdout.write(
    `${JSON.stringify({ status: terminal.status, submit_calls: submitCalls, assets: rows.length })}\n`,
  );
  await engine.stop();
  await closeDatabaseState(state);
}

void main().catch((error: unknown) => {
  process.stderr.write(`Crash fixture failed: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});

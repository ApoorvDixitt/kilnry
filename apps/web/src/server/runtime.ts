// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import {
  JobEngine,
  ProviderKeyStore,
  eventHub,
  libraryMarker,
  loadConfig,
  reindexLibrary,
  saveConfig,
  seedRegistry,
  watchLibrary,
  type LibraryWatcher,
} from '@kilnry/core';
import { closeDatabase, database, hasLocalUser, type DatabaseState } from '@kilnry/db';
import { adapters } from '@kilnry/providers';
import { log } from './log';

export type RuntimeStage =
  'idle' | 'migrating' | 'indexing' | 'starting_workers' | 'ready' | 'error' | 'shutting_down';

interface RuntimeStatus {
  stage: RuntimeStage;
  readyAt?: string;
  error?: string;
}

export interface RuntimeServices {
  database: DatabaseState;
  keyStore: ProviderKeyStore;
  engine?: JobEngine;
  watcher?: LibraryWatcher;
}

type RuntimeGlobal = typeof globalThis & {
  __kilnryRuntime?: Promise<void>;
  __kilnryRuntimeStatus?: RuntimeStatus;
  __kilnrySignalsInstalled?: boolean;
  __kilnryServices?: RuntimeServices;
  __kilnryEngineStart?: Promise<JobEngine>;
};

function globalRuntime(): RuntimeGlobal {
  return globalThis as RuntimeGlobal;
}

function ensureSetupToken(dataDir: string, port: number): void {
  const tokenPath = join(dataDir, 'first-run.token');
  if (!existsSync(tokenPath)) {
    const token = randomBytes(32).toString('hex');
    writeFileSync(tokenPath, `${token}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    chmodSync(tokenPath, 0o600);
  }
  const token = readFileSync(tokenPath, 'utf8').trim();
  process.stdout.write(`\nOpen this link to finish setup:\nhttp://127.0.0.1:${port}/welcome?t=${token}\n\n`);
}

async function boot(): Promise<void> {
  const global = globalRuntime();
  global.__kilnryRuntimeStatus = { stage: 'migrating' };
  const config = loadConfig();
  const state = database(config.data_dir);
  await state.ready;
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    global.__kilnryRuntimeStatus = { stage: 'ready', readyAt: new Date().toISOString() };
    return;
  }
  if (!(await hasLocalUser(config.data_dir))) ensureSetupToken(config.data_dir, config.port);
  if (!existsSync(join(config.data_dir, 'config.json'))) saveConfig(config);
  await seedRegistry(state);
  global.__kilnryServices = {
    database: state,
    keyStore: new ProviderKeyStore({
      dataDir: config.data_dir,
      database: state,
      onWarning: (message, error) => log.warn({ err: error }, message),
    }),
  };
  if (config.library_root && existsSync(join(config.library_root, '.kilnry', 'library.json'))) {
    await ensureRuntimeEngine();
  }
  global.__kilnryRuntimeStatus = { stage: 'ready', readyAt: new Date().toISOString() };
  log.info({ data_dir: config.data_dir, host: config.host, port: config.port }, 'runtime_ready');
  process.stdout.write(
    `Kilnry ${process.env.npm_package_version ?? '0.0.0'} · fair-code, Sustainable Use License 1.0 · https://github.com/ApoorvDixitt/kilnry\n`,
  );

  if (!global.__kilnrySignalsInstalled) {
    global.__kilnrySignalsInstalled = true;
    const shutdown = async (): Promise<void> => {
      global.__kilnryRuntimeStatus = { stage: 'shutting_down' };
      try {
        await global.__kilnryServices?.watcher?.close();
        await global.__kilnryServices?.engine?.stop();
        await closeDatabase();
        await log.flush();
      } catch (error) {
        process.stderr.write(
          `Kilnry shutdown failed: ${error instanceof Error ? error.message : String(error)}\n`,
        );
        process.exitCode = 1;
      }
    };
    process.once('SIGTERM', () => void shutdown());
    process.once('SIGINT', () => void shutdown());
  }
}

export function startRuntime(): Promise<void> {
  const global = globalRuntime();
  global.__kilnryRuntimeStatus ??= { stage: 'idle' };
  global.__kilnryRuntime ??= boot().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    global.__kilnryRuntimeStatus = { stage: 'error', error: message };
    log.error({ err: error }, 'runtime_start_failed');
    process.stderr.write(`Kilnry failed to start: ${message}\n`);
    throw error;
  });
  return global.__kilnryRuntime;
}

export function runtimeStatus(): RuntimeStatus {
  return globalRuntime().__kilnryRuntimeStatus ?? { stage: 'idle' };
}

export function runtimeWorkerStatus(): 'ok' | 'paused' {
  return globalRuntime().__kilnryServices?.engine ? 'ok' : 'paused';
}

export async function runtimeServices(): Promise<RuntimeServices> {
  await startRuntime();
  const services = globalRuntime().__kilnryServices;
  if (!services) throw new Error('Kilnry runtime services are unavailable.');
  return services;
}

export async function ensureRuntimeEngine(): Promise<JobEngine> {
  const global = globalRuntime();
  if (!global.__kilnryRuntime && !global.__kilnryServices) await startRuntime();
  if (global.__kilnryServices?.engine) return global.__kilnryServices.engine;
  global.__kilnryEngineStart ??= (async () => {
    const services = global.__kilnryServices;
    if (!services) throw new Error('Kilnry runtime services are unavailable.');
    const config = loadConfig();
    if (!config.library_root) throw new Error('Choose a Library root before starting the job engine.');
    if (process.env.KILNRY_TEST_MSW === '1') {
      if (process.env.KILNRY_RELEASE_BUILD === '1') {
        throw new Error('KILNRY_TEST_MSW is forbidden in release builds.');
      }
      const { startTestMsw } = await import('../test/msw-server');
      startTestMsw();
    }
    global.__kilnryRuntimeStatus = { stage: 'indexing' };
    const marker = await libraryMarker(config.library_root);
    await reindexLibrary(services.database, config.library_root, marker.library_id, {
      reportDir: join(config.data_dir, 'logs'),
    });
    global.__kilnryRuntimeStatus = { stage: 'starting_workers' };
    const engine = new JobEngine({
      state: services.database,
      keyStore: services.keyStore,
      adapters,
      dataDir: config.data_dir,
      libraryRoot: config.library_root,
      libraryId: marker.library_id,
      events: eventHub,
      log: (level, event, meta) => log[level]({ ...(meta ?? {}) }, event),
    });
    await engine.start();
    const watcher = watchLibrary({
      state: services.database,
      root: config.library_root,
      libraryId: marker.library_id,
      polling: process.env.CHOKIDAR_USEPOLLING === '1' || process.env.KILNRY_DOCKER === '1',
      onImported: (assetId, folder) =>
        eventHub.emit({
          type: 'library.imported',
          asset_id: assetId,
          folder,
          ts: new Date().toISOString(),
        }),
      onError: (error) => log.error({ err: error }, 'library_watcher_error'),
    });
    await watcher.ready;
    services.engine = engine;
    services.watcher = watcher;
    return engine;
  })();
  try {
    return await global.__kilnryEngineStart;
  } catch (error) {
    delete global.__kilnryEngineStart;
    throw error;
  }
}

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { loadConfig, saveConfig } from '@kilnry/core/config';
import { closeDatabase, database, hasLocalUser } from '@kilnry/db';
import { log } from './log';

export type RuntimeStage = 'idle' | 'migrating' | 'ready' | 'error' | 'shutting_down';

interface RuntimeStatus {
  stage: RuntimeStage;
  readyAt?: string;
  error?: string;
}

type RuntimeGlobal = typeof globalThis & {
  __kilnryRuntime?: Promise<void>;
  __kilnryRuntimeStatus?: RuntimeStatus;
  __kilnrySignalsInstalled?: boolean;
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

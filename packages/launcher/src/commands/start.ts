// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { launcherDataDir } from '../paths.js';
import { readServerLock } from '../server-lock.js';
import { openBrowser } from '../browser.js';

interface CurrentRelease {
  version: string;
}

function serverEntry(): string {
  if (process.env.KILNRY_SERVER_ENTRY) return process.env.KILNRY_SERVER_ENTRY;
  const currentPath = join(launcherDataDir(), 'releases', 'current.json');
  if (!existsSync(currentPath)) {
    throw new Error('No Kilnry server build is installed yet. In this source checkout, run: pnpm dev');
  }
  const current = JSON.parse(readFileSync(currentPath, 'utf8')) as CurrentRelease;
  const entry = join(launcherDataDir(), 'releases', current.version, 'server.js');
  if (!existsSync(entry)) throw new Error(`Installed server entry is missing: ${entry}`);
  return entry;
}

export async function startServer(options: { port: number; noOpen: boolean }): Promise<number> {
  const dataDir = launcherDataDir();
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  // The server takes <dataDir>/kilnry.lock exclusively before it opens the
  // database (@kilnry/db lock.ts, F-101), so the launcher reads that one lock
  // instead of keeping a pidfile of its own written after spawn (F-69). A
  // second start that races past this check is still refused by the lock
  // before its server can touch the database.
  const holder = readServerLock(dataDir);
  if (holder) {
    const port = holder.port ?? options.port;
    process.stdout.write(`Kilnry is already running (pid ${holder.pid}) at http://127.0.0.1:${port}\n`);
    if (!options.noOpen) openBrowser(`http://127.0.0.1:${port}`);
    return 0;
  }
  const entry = serverEntry();
  const configPath = join(dataDir, 'config.json');
  const config = existsSync(configPath)
    ? (JSON.parse(readFileSync(configPath, 'utf8')) as { lan_enabled?: boolean })
    : {};
  const lanEnabled = process.env.KILNRY_LAN === '1' || config.lan_enabled === true;
  const child = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      HOSTNAME: lanEnabled ? '0.0.0.0' : '127.0.0.1',
      KILNRY_LAN: lanEnabled ? '1' : '0',
      KILNRY_PORT: String(options.port),
      PORT: String(options.port),
    },
    stdio: 'inherit',
  });

  const health = `http://127.0.0.1:${options.port}/api/health`;
  const deadline = Date.now() + 60_000;
  let lastHealthError = 'the health endpoint did not return 200';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(health);
      if (response.ok) {
        process.stdout.write(`Kilnry is running at http://127.0.0.1:${options.port} · Ctrl-C to stop\n`);
        if (!options.noOpen) openBrowser(`http://127.0.0.1:${options.port}`);
        break;
      }
      lastHealthError = `health endpoint returned ${response.status}`;
    } catch (error) {
      lastHealthError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (Date.now() >= deadline) {
    child.kill('SIGTERM');
    throw new Error(
      `Kilnry did not become healthy within 60 seconds: ${lastHealthError}. Check ${join(launcherDataDir(), 'logs', 'kilnry.log')}.`,
    );
  }
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
    process.once('SIGINT', () => child.kill('SIGTERM'));
    process.once('SIGTERM', () => child.kill('SIGTERM'));
  });
}

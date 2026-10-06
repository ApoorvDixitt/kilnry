// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// F-69 / F-101: the launcher's "already running" check reads the server's
// data-directory lock, not a pidfile it wrote after spawning.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readServerLock } from '../server-lock.js';
import { startServer } from './start.js';

const roots: string[] = [];
const original = process.env.KILNRY_DATA_DIR;
afterEach(() => {
  vi.restoreAllMocks();
  if (original === undefined) delete process.env.KILNRY_DATA_DIR;
  else process.env.KILNRY_DATA_DIR = original;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function dataDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'kilnry-launcher-lock-'));
  roots.push(root);
  process.env.KILNRY_DATA_DIR = root;
  return root;
}

describe('kilnry start and the data-directory lock (F-69)', () => {
  it('reports the live holder of the lock and starts nothing', async () => {
    const root = dataDir();
    // The parent of the test runner is a live process that is not this one.
    writeFileSync(join(root, 'kilnry.lock'), `${JSON.stringify({ pid: process.ppid, port: 3999 })}\n`);
    const writes: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    });
    // No server build is installed here, so reaching the spawn would throw.
    await expect(startServer({ port: 3123, noOpen: true })).resolves.toBe(0);
    expect(writes.join('')).toBe(
      `Kilnry is already running (pid ${process.ppid}) at http://127.0.0.1:3999\n`,
    );
  });

  it('ignores a lock whose process has exited', async () => {
    const root = dataDir();
    const gone = spawn(process.execPath, ['-e', '']);
    const pid = gone.pid!;
    await new Promise((resolve) => gone.once('close', resolve));
    writeFileSync(join(root, 'kilnry.lock'), `${JSON.stringify({ pid })}\n`);
    expect(readServerLock(root)).toBeUndefined();
    // With no live holder the launcher goes on to look for a server build.
    await expect(startServer({ port: 3123, noOpen: true })).rejects.toThrow(/No Kilnry server build/);
  });

  it('finds no holder when there is no lock', () => {
    expect(readServerLock(dataDir())).toBeUndefined();
  });
});

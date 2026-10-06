// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// F-101: PGlite runs Postgres in single-user mode, "one connection, one process
// per data directory" (TRD-01 §2.1). A second process that opens the same
// directory must be refused before it can write; otherwise the two silently
// lose each other's committed rows.

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDatabaseState, createDatabase } from './client.js';
import { acquireDataDirLock, DataDirLockedError, LOCK_FILE } from './lock.js';

const fixture = fileURLToPath(new URL('./lock.fixture.ts', import.meta.url));
const children = new Set<ChildProcess>();
const roots: string[] = [];

afterEach(() => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
  children.clear();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

interface Watched {
  child: ChildProcess;
  stdout: () => string;
  stderr: () => string;
  waitFor: (pattern: RegExp, timeoutMs?: number) => Promise<void>;
  exited: Promise<number | null>;
}

function launch(dataDir: string, tag: string, count: number): Watched {
  const child = spawn(process.execPath, ['--import', 'tsx', fixture, dataDir, tag, String(count)], {
    cwd: dirname(dirname(fixture)),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  let out = '';
  let err = '';
  child.stdout?.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
  child.stderr?.on('data', (chunk: Buffer) => (err += chunk.toString('utf8')));
  const exited = new Promise<number | null>((resolve) => child.once('close', (code) => resolve(code)));
  // A child boots tsx, PGlite and the migrations; under a loaded machine or a
  // 4-vCPU CI runner that takes far longer than it does alone.
  const waitFor = (pattern: RegExp, timeoutMs = 60_000) =>
    new Promise<void>((resolve, reject) => {
      const started = Date.now();
      const tick = setInterval(() => {
        if (pattern.test(out)) {
          clearInterval(tick);
          resolve();
        } else if (child.exitCode !== null || Date.now() - started > timeoutMs) {
          clearInterval(tick);
          reject(new Error(`no ${pattern} from ${tag}: stdout=${out} stderr=${err}`));
        }
      }, 20);
    });
  return { child, stdout: () => out, stderr: () => err, waitFor, exited };
}

describe('the data directory is held by one process (F-NFR-06)', () => {
  it('refuses a second process before it writes, and keeps the first process rows', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kilnry-lock-'));
    roots.push(root);
    const dataDir = join(root, 'data');

    const first = launch(dataDir, 'A', 20);
    await first.waitFor(/WROTE 2\n/);

    // The second opener of the same directory: it must exit before it reports
    // the database opened, with the one message every opener gets.
    const second = launch(dataDir, 'B', 20);
    const outcome = await Promise.race([
      second.exited.then((code) => ({ code, opened: /OPENED/.test(second.stdout()) })),
      second.waitFor(/OPENED\n/, 60_000).then(() => ({ code: null, opened: true })),
    ]);
    expect(outcome.opened).toBe(false);
    expect(second.stdout()).not.toMatch(/WROTE/);
    expect(outcome.code).toBe(3);
    expect(second.stderr()).toContain(`Kilnry is already running (pid ${first.child.pid})`);

    await first.waitFor(/DONE\n/);
    first.child.kill('SIGTERM');
    await first.exited;

    // A fresh reader sees every row the first process committed.
    const reader = createDatabase(dataDir);
    try {
      await reader.ready;
      const rows = await reader.client.query<{ tag: string; count: number }>(
        'select tag, count(*)::int as count from lock_probe group by tag order by tag',
      );
      expect(rows.rows).toEqual([{ tag: 'A', count: 20 }]);
    } finally {
      await closeDatabaseState(reader);
    }
    expect(existsSync(join(dataDir, LOCK_FILE))).toBe(false);
  }, 180_000);

  it('is re-entrant for the process that holds it', () => {
    const root = mkdtempSync(join(tmpdir(), 'kilnry-lock-reentrant-'));
    roots.push(root);
    // A dev-server module re-evaluation opens again from the same process.
    const releaseFirst = acquireDataDirLock(root);
    const releaseSecond = acquireDataDirLock(root);
    const held = JSON.parse(readFileSync(join(root, LOCK_FILE), 'utf8')) as { pid: number };
    expect(held.pid).toBe(process.pid);
    releaseSecond();
    expect(existsSync(join(root, LOCK_FILE))).toBe(true);
    releaseFirst();
    expect(existsSync(join(root, LOCK_FILE))).toBe(false);
  });

  it('reclaims a lock whose recorded process is gone', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kilnry-lock-stale-'));
    roots.push(root);
    // A process that has exited leaves its pid behind (a crash or a SIGKILL).
    const gone = spawn(process.execPath, ['-e', '']);
    const pid = gone.pid!;
    await new Promise((resolve) => gone.once('close', resolve));
    writeFileSync(
      join(root, LOCK_FILE),
      `${JSON.stringify({ pid, started_at: new Date().toISOString() })}\n`,
    );
    const release = acquireDataDirLock(root);
    const held = JSON.parse(readFileSync(join(root, LOCK_FILE), 'utf8')) as { pid: number };
    expect(held.pid).toBe(process.pid);
    release();
  });

  it('names the holder when another live process has the lock', () => {
    const root = mkdtempSync(join(tmpdir(), 'kilnry-lock-held-'));
    roots.push(root);
    // The parent of this test runner is alive and is not this process.
    writeFileSync(join(root, LOCK_FILE), `${JSON.stringify({ pid: process.ppid })}\n`);
    expect(() => acquireDataDirLock(root)).toThrow(DataDirLockedError);
    expect(() => acquireDataDirLock(root)).toThrow(`Kilnry is already running (pid ${process.ppid})`);
  });
});

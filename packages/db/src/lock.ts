// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The data-directory lock (F-101, F-NFR-06). PGlite runs Postgres in
// single-user mode, "one connection, one process per data directory" (TRD-01
// §2.1), and two processes on one directory silently lose each other's
// committed rows. So whoever opens the database — the server, `pnpm dev`, a
// test — first creates <dataDir>/kilnry.lock exclusively with its pid inside,
// and every other opener is refused with one message. The launcher reads the
// same file to say "already running" instead of keeping its own pidfile.

import { closeSync, openSync, readFileSync, rmSync, statSync, writeSync } from 'node:fs';
import { join } from 'node:path';

export const LOCK_FILE = 'kilnry.lock';

export interface DataDirLockRecord {
  pid: number;
  port?: number;
  started_at?: string;
}

export class DataDirLockedError extends Error {
  readonly pid: number | undefined;
  readonly lockPath: string;
  constructor(pid: number | undefined, lockPath: string) {
    super(
      pid === undefined
        ? `Kilnry is already running (${lockPath} is held)`
        : `Kilnry is already running (pid ${pid})`,
    );
    this.name = 'DataDirLockedError';
    this.pid = pid;
    this.lockPath = lockPath;
  }
}

// How many opens this process holds per lock path. Kept on globalThis so a dev
// server that re-evaluates this module keeps counting the same holds.
type LockGlobal = typeof globalThis & { __kilnryDataDirLocks?: Map<string, number> };

function holds(): Map<string, number> {
  const global = globalThis as LockGlobal;
  global.__kilnryDataDirLocks ??= new Map();
  return global.__kilnryDataDirLocks;
}

// A lock file that is empty or half-written belongs to an opener between its
// exclusive create and its write; after this long it is a crash in that window.
const UNREADABLE_GRACE_MS = 5_000;

function readRaw(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function parse(raw: string | undefined): DataDirLockRecord | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  try {
    const value = JSON.parse(raw) as Partial<DataDirLockRecord>;
    return typeof value.pid === 'number' && Number.isInteger(value.pid)
      ? (value as DataDirLockRecord)
      : undefined;
  } catch {
    return undefined;
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return false;
    // EPERM: the process exists but belongs to someone else.
    if (code === 'EPERM') return true;
    throw error;
  }
}

/** The lock's current record, or undefined when nobody holds it. */
export function readDataDirLock(dataDir: string): DataDirLockRecord | undefined {
  return parse(readRaw(join(dataDir, LOCK_FILE)));
}

function port(): number | undefined {
  const value = Number(process.env.KILNRY_PORT ?? process.env.PORT);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

const exitHooked = new Set<string>();

function removeIfOurs(path: string): void {
  if (parse(readRaw(path))?.pid === process.pid) rmSync(path, { force: true });
}

/**
 * Take the data-directory lock before the database is opened. Returns the
 * release function; throws DataDirLockedError when a live process holds it.
 */
export function acquireDataDirLock(dataDir: string): () => void {
  const path = join(dataDir, LOCK_FILE);
  const counts = holds();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const fd = openSync(path, 'wx', 0o600);
      try {
        const record: DataDirLockRecord = { pid: process.pid, started_at: new Date().toISOString() };
        const listening = port();
        if (listening !== undefined) record.port = listening;
        writeSync(fd, `${JSON.stringify(record)}\n`);
      } finally {
        closeSync(fd);
      }
      counts.set(path, 1);
      return release(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const raw = readRaw(path);
    if (raw === undefined) continue; // released between our create and read
    const held = parse(raw);
    if (!held) {
      let age: number;
      try {
        age = Date.now() - statSync(path).mtimeMs;
      } catch {
        continue;
      }
      if (age < UNREADABLE_GRACE_MS) throw new DataDirLockedError(undefined, path);
    } else if (held.pid === process.pid) {
      // Re-entrant: this process already holds the directory.
      counts.set(path, (counts.get(path) ?? 0) + 1);
      return release(path);
    } else if (alive(held.pid)) {
      throw new DataDirLockedError(held.pid, path);
    }
    // ESRCH (or a stale unreadable file): the holder is gone. Remove the file
    // only if it still says what we read, then try the exclusive create again.
    if (readRaw(path) === raw) rmSync(path, { force: true });
  }
  throw new DataDirLockedError(parse(readRaw(path))?.pid, path);
}

function release(path: string): () => void {
  if (!exitHooked.has(path)) {
    exitHooked.add(path);
    // A process that exits without closing the database still lets go.
    process.once('exit', () => {
      if ((holds().get(path) ?? 0) > 0) removeIfOurs(path);
    });
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const counts = holds();
    const left = (counts.get(path) ?? 1) - 1;
    if (left > 0) {
      counts.set(path, left);
      return;
    }
    counts.delete(path);
    removeIfOurs(path);
  };
}

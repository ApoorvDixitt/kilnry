// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Reads the data-directory lock the server takes before it opens the database
// (written by packages/db/src/lock.ts as { pid, port?, started_at }). The
// launcher stays free of the database package to keep its install small, so it
// reads the same JSON here.

import { readFileSync } from 'node:fs';
import { launcherLockPath } from './paths.js';

export interface ServerLock {
  pid: number;
  port?: number;
}

/** The live process holding the data directory, or undefined when none does. */
export function readServerLock(dataDir: string): ServerLock | undefined {
  let raw: string;
  try {
    raw = readFileSync(launcherLockPath(dataDir), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  let value: Partial<ServerLock>;
  try {
    value = JSON.parse(raw) as Partial<ServerLock>;
  } catch {
    // Half-written by a server that is starting right now; the server's own
    // lock decides, so let the start proceed and be refused there if needed.
    return undefined;
  }
  if (typeof value.pid !== 'number') return undefined;
  try {
    process.kill(value.pid, 0);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return undefined; // stale: the server reclaims it
    if (code !== 'EPERM') throw error;
  }
  return typeof value.port === 'number' ? { pid: value.pid, port: value.port } : { pid: value.pid };
}

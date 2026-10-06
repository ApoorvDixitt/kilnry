// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export function launcherDataDir(): string {
  return resolve(process.env.KILNRY_DATA_DIR ?? join(homedir(), '.kilnry'));
}

export function launcherConfigPath(): string {
  return join(launcherDataDir(), 'config.json');
}

// The server's data-directory lock (packages/db/src/lock.ts), which replaced
// the launcher's own kilnry.pid (F-101, F-69).
export function launcherLockPath(dataDir = launcherDataDir()): string {
  return join(dataDir, 'kilnry.lock');
}

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

export function launcherPidPath(): string {
  return join(launcherDataDir(), 'kilnry.pid');
}

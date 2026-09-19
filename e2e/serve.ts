// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const root = process.cwd();
for (const directory of ['e2e-data', 'e2e-library']) {
  const path = join(root, '.dev', directory);
  rmSync(path, { recursive: true, force: true });
  mkdirSync(path, { recursive: true, mode: 0o700 });
}

const detached = process.platform !== 'win32';
const child = spawn('tsx', ['scripts/dev.ts'], {
  cwd: root,
  detached,
  env: {
    ...process.env,
    KILNRY_MASTER_KEY: process.env.KILNRY_MASTER_KEY ?? randomBytes(32).toString('hex'),
  },
  stdio: 'inherit',
});
let stopping = false;

function stop(signal: NodeJS.Signals): void {
  if (stopping) return;
  stopping = true;
  if (!child.pid) {
    process.stderr.write('The e2e server process has no pid; it cannot be stopped cleanly.\n');
    process.exitCode = 1;
    return;
  }
  if (detached) process.kill(-child.pid, signal);
  else child.kill(signal);
}

process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));
child.once('error', (error) => {
  process.stderr.write(`Unable to start the e2e server: ${error.message}\n`);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  process.exit(stopping ? 0 : (code ?? (signal ? 1 : 0)));
});

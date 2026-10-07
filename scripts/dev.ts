// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { spawn } from 'node:child_process';
import { join } from 'node:path';

const root = process.cwd();
// Stream the server's output as it is written. Turbo's default log order,
// `auto`, groups a task's output until the task finishes when it detects CI, and
// a dev server never finishes — so in CI nothing it printed, including the
// first-run setup link, reached the terminal (T53 fix-forward).
const child = spawn('turbo', ['run', 'dev', '--filter=@kilnry/web', '--log-order=stream'], {
  cwd: root,
  env: {
    ...process.env,
    KILNRY_DATA_DIR: process.env.KILNRY_DATA_DIR ?? join(root, '.dev', 'kilnry'),
  },
  stdio: 'inherit',
});

let stopping = false;
function stop(signal: NodeJS.Signals): void {
  if (stopping) return;
  stopping = true;
  if (!child.kill(signal)) {
    process.stderr.write(
      `The development server did not accept ${signal}; stop pid ${String(child.pid)} manually.\n`,
    );
  }
}

process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));
child.once('error', (error) => {
  process.stderr.write(`Unable to start Kilnry development mode: ${error.message}\n`);
  process.exitCode = 1;
});
child.once('exit', (code) => process.exit(stopping ? 0 : (code ?? 1)));

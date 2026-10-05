// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Production-build smoke (Group 5). The web app is built with output:
// 'standalone' and bundles @kilnry/core through transpilePackages, so
// appVersion() — which reads @kilnry/core's package.json via createRequire —
// must still resolve inside the bundle. Every acceptance run uses `next dev`, so
// this is the one check that exercises the standalone server. It starts the
// built server once, reads /api/health (unauthenticated, reports appVersion()),
// and asserts the version equals packages/core/package.json's. A mismatch (or an
// unresolved createRequire) fails here.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const coreVersion = (
  JSON.parse(readFileSync(join(root, 'packages', 'core', 'package.json'), 'utf8')) as { version: string }
).version;

const entry = join(root, 'apps', 'web', '.next', 'standalone', 'apps', 'web', 'server.js');
if (!existsSync(entry)) {
  process.stderr.write(
    `Standalone server not found at ${entry}. Run \`pnpm --filter @kilnry/web build\` first.\n`,
  );
  process.exit(1);
}

const PORT = 3131;
const dataDir = join(root, '.dev', 'prod-smoke-data');
const child = spawn(process.execPath, [entry], {
  cwd: join(root, 'apps', 'web', '.next', 'standalone', 'apps', 'web'),
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(PORT),
    HOSTNAME: '127.0.0.1',
    KILNRY_DATA_DIR: dataDir,
    KILNRY_LIBRARY_ROOT: join(root, '.dev', 'prod-smoke-library'),
    KILNRY_MASTER_KEY: 'f'.repeat(64),
  },
  stdio: 'inherit',
});

function stop(code: number): never {
  if (child.pid) {
    try {
      process.kill(child.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
  process.exit(code);
}

async function main(): Promise<void> {
  // Wait for /api/health to answer 200 with a version.
  const deadline = Date.now() + 90_000;
  let body: { ok?: boolean; version?: string } | undefined;
  for (;;) {
    if (Date.now() > deadline) {
      process.stderr.write('The standalone server did not become healthy within 90s.\n');
      stop(1);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/api/health`);
      if (response.ok) {
        body = (await response.json()) as { ok?: boolean; version?: string };
        if (body.ok && body.version) break;
      }
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  if (body?.version !== coreVersion) {
    process.stderr.write(
      `Production build smoke FAILED: /api/health version ${body?.version} != packages/core ${coreVersion}. ` +
        'appVersion() did not resolve @kilnry/core through the standalone bundle.\n',
    );
    stop(1);
  }
  process.stdout.write(
    `Production build smoke OK: standalone /api/health version ${body.version} == packages/core/package.json.\n`,
  );
  stop(0);
}

void main();

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { parseArgs } from 'node:util';
import { printDoctor, runDoctor } from './commands/doctor.js';
import { startServer } from './commands/start.js';

const version = process.env.npm_package_version ?? '0.0.0';

async function main(): Promise<void> {
  const command = process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : 'start';
  const argv =
    command === 'start' && process.argv[2] !== 'start' ? process.argv.slice(2) : process.argv.slice(3);
  const parsed = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      json: { type: 'boolean' },
      'no-open': { type: 'boolean' },
      port: { type: 'string' },
      version: { type: 'boolean', short: 'v' },
    },
  });

  if (parsed.values.version) {
    process.stdout.write(`Kilnry ${version} · Sustainable Use License 1.0 · (c) 2026 Apoorv Dixit\n`);
    return;
  }
  if (parsed.values.help) {
    process.stdout.write('Usage: kilnry [start] [--port 3123] [--no-open]\n       kilnry doctor [--json]\n');
    return;
  }
  if (command === 'doctor') {
    const checks = await runDoctor();
    printDoctor(checks, parsed.values.json ?? false);
    if (checks.some((check) => check.status === 'fail')) process.exitCode = 1;
    return;
  }
  if (command !== 'start') throw new Error(`Unknown command: ${command}`);
  const port = Number(parsed.values.port ?? process.env.KILNRY_PORT ?? 3123);
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new Error(`Invalid port: ${String(parsed.values.port)}`);
  process.exitCode = await startServer({ port, noOpen: parsed.values['no-open'] ?? false });
}

void main().catch((error: unknown) => {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

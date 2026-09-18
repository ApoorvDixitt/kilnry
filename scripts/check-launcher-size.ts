// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { spawnSync } from 'node:child_process';

interface PackReport {
  size: number;
  unpackedSize: number;
  files: Array<{ path: string }>;
}

const result = spawnSync('npm', ['pack', '--dry-run', '--json'], {
  cwd: 'packages/launcher',
  encoding: 'utf8',
});
if (result.status !== 0) {
  throw new Error(`Unable to inspect the launcher package: ${result.stderr.trim()}`);
}

const reports = JSON.parse(result.stdout) as PackReport[];
const report = reports[0];
if (!report) throw new Error('npm pack returned no launcher report.');
const limit = 10 * 1024 * 1024;
if (report.size >= limit) {
  throw new Error(
    `Launcher tarball is ${(report.size / 1024 / 1024).toFixed(2)} MB; it must stay below 10 MB.`,
  );
}
const paths = new Set(report.files.map((file) => file.path));
for (const required of ['bin/kilnry.js', 'LICENSE.md']) {
  if (!paths.has(required)) throw new Error(`Launcher package is missing required file: ${required}`);
}
process.stdout.write(
  `Launcher package verified: ${(report.size / 1024).toFixed(1)} KB compressed, ${(report.unpackedSize / 1024).toFixed(1)} KB unpacked.\n`,
);

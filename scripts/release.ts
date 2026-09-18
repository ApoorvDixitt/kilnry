// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { spawnSync } from 'node:child_process';

const allowed = new Set(['patch', 'minor', 'major', 'prerelease']);
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const release = args.find((arg) => !arg.startsWith('--'));

if (!release || !allowed.has(release)) {
  process.stderr.write('Usage: pnpm release <patch|minor|major|prerelease> [--dry-run]\n');
  process.exit(1);
}

function run(command: string, commandArgs: string[], capture = false): string {
  const result = spawnSync(command, commandArgs, { encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
  if (result.status !== 0) {
    const detail = capture ? result.stderr.trim() : `exit code ${result.status ?? 'unknown'}`;
    throw new Error(`${command} ${commandArgs.join(' ')} failed: ${detail}`);
  }
  return capture ? result.stdout.trim() : '';
}

const branch = run('git', ['branch', '--show-current'], true);
if (branch !== 'main')
  throw new Error(`Releases must be prepared from main, not ${branch || '(detached HEAD)'}.`);
if (run('git', ['status', '--porcelain'], true)) throw new Error('Release requires a clean working tree.');

const commandArgs = ['exec', 'commit-and-tag-version', '--release-as', release];
if (dryRun) commandArgs.push('--dry-run');
run('pnpm', commandArgs);
process.stdout.write(
  dryRun
    ? 'Release preview completed without changing files.\n'
    : 'Release commit and annotated tag created locally. Review them, then push explicitly with git push --follow-tags origin main.\n',
);

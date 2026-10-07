// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// D-66 / TRD-19 §2 (H-2): "SIGKILL … during the `run.kilnry.json` tmp+rename
// write; on restart … no truncated manifest". The write is atomic by
// construction, and nothing proved it. A child rewrites a ~2 MB manifest in a
// loop and is killed at thirty points; the manifest must parse every time,
// and a leftover temporary file is one the Library watcher ignores.

import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { watcherIgnores } from '@kilnry/core';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function killDuringWrites(dir: string, afterMs: number): Promise<void> {
  const fixture = fileURLToPath(new URL('./manifest-crash.fixture.ts', import.meta.url));
  const child = spawn(process.execPath, ['--import', 'tsx', fixture, dir], {
    cwd: dirname(dirname(dirname(fixture))),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((resolve, reject) => {
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    child.stdout.on('data', (chunk: Buffer) => {
      if (chunk.toString('utf8').includes('WRITING')) setTimeout(() => child.kill('SIGKILL'), afterMs);
    });
    child.once('exit', (_code, signal) => (signal === 'SIGKILL' ? resolve() : reject(new Error(stderr))));
  });
}

describe.skipIf(process.platform === 'win32')('SIGKILL during the run manifest write (H-2, D-66)', () => {
  it('always leaves a whole manifest, never a truncated one', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kilnry-manifest-crash-'));
    roots.push(root);
    const dir = join(root, 'Library', 'Run_A');
    // Thirty kills spread over the loop: most of each iteration is
    // JSON.stringify, so many kills are needed for some to land inside a write.
    for (const afterMs of Array.from({ length: 30 }, (_, n) => (n * 37) % 211)) {
      await killDuringWrites(dir, afterMs);
      const manifest = JSON.parse(readFileSync(join(dir, 'run.kilnry.json'), 'utf8')) as {
        version: string;
        steps: unknown[];
      };
      expect(['A', 'B']).toContain(manifest.version);
      expect(manifest.steps).toHaveLength(20_000);
      for (const name of readdirSync(dir).filter((file) => file !== 'run.kilnry.json')) {
        expect(watcherIgnores(join(dir, name), join(root, 'Library'))).toBe(true);
      }
    }
  }, 120_000);
});

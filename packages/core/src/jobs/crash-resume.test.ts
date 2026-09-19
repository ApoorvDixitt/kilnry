// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const children = new Set<ChildProcess>();
const roots: string[] = [];

afterEach(async () => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
  children.clear();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function launch(args: string[], masterKey: string): ChildProcess {
  const fixture = fileURLToPath(new URL('./crash-worker.fixture.ts', import.meta.url));
  const child = spawn(process.execPath, ['--import', 'tsx', fixture, ...args], {
    cwd: dirname(dirname(dirname(fixture))),
    env: { ...process.env, KILNRY_CRASH_TEST_MASTER_KEY: masterKey },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  return child;
}

function waitForExit(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve) => child.once('exit', (code) => resolve(code)));
}

function waitForOutput(child: ChildProcess, match: RegExp, timeoutMs = 15_000): Promise<RegExpMatchArray> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      reject(new Error(`Child output timed out. stdout=${stdout} stderr=${stderr}`));
    }, timeoutMs);
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      const found = stdout.match(match);
      if (!found) return;
      clearTimeout(timeout);
      resolve(found);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      if (match.test(stdout)) return;
      clearTimeout(timeout);
      reject(new Error(`Child exited before expected output (${code ?? signal}). stderr=${stderr}`));
    });
  });
}

describe.skipIf(process.platform === 'win32')('process crash recovery', () => {
  it('kills the worker during polling and resumes by polling without a second submit', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kilnry-crash-resume-'));
    roots.push(root);
    const masterKey = randomBytes(32).toString('hex');
    const first = launch(['submit', root], masterKey);
    const ready = await waitForOutput(first, /READY ([0-9A-HJKMNP-TV-Z]{26})/);
    const jobId = ready[1]!;
    expect(first.kill('SIGKILL')).toBe(true);
    await waitForExit(first);

    const second = launch(['resume', root, jobId], masterKey);
    const completed = await waitForOutput(second, /(\{"status":"completed"[^\n]+\})/);
    const result = JSON.parse(completed[1]!) as {
      status: string;
      submit_calls: number;
      assets: number;
    };
    expect(result).toEqual({ status: 'completed', submit_calls: 0, assets: 1 });
    expect(await waitForExit(second)).toBe(0);
  }, 30_000);
});

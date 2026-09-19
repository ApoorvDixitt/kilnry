// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { spawn } from 'node:child_process';

export async function runMediaProcess(
  command: string,
  arguments_: string[],
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const abort = (): void => {
      child.kill('SIGTERM');
      finish(new Error(`${command} was cancelled.`));
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error(`${command} exceeded its ${options.timeoutMs ?? 120_000} ms timeout.`));
    }, options.timeoutMs ?? 120_000);
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else {
        resolve({
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
        });
      }
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => {
      if (stdoutBytes >= 16 * 1024 * 1024) return;
      stdout.push(chunk);
      stdoutBytes += chunk.byteLength;
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderrBytes >= 16 * 1024 * 1024) return;
      stderr.push(chunk);
      stderrBytes += chunk.byteLength;
    });
    child.once('error', (error) =>
      finish(new Error(`Could not start ${command}: ${error.message}`, { cause: error })),
    );
    child.once('exit', (code, signal) => {
      if (code === 0) {
        finish();
        return;
      }
      const tail = Buffer.concat(stderr).toString('utf8').trim().split('\n').slice(-20).join('\n');
      finish(new Error(`${command} exited with ${code ?? signal ?? 'unknown'}${tail ? `: ${tail}` : ''}`));
    });
  });
}

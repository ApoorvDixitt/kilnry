// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// D-66 / TRD-19 §2 (F-70): "SIGKILL during a watcher import … on restart no
// partial sidecar, … the per-path lock holds no stale entry, and the queued
// import_path job completes". Nothing proved the import survives a kill. The
// child indexes forty files the way the import_path job does and is killed
// part-way; a second process reopens the same database and Library.

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const children = new Set<ChildProcess>();
const roots: string[] = [];
afterEach(() => {
  for (const child of children)
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  children.clear();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function launch(phase: string, root: string): ChildProcess {
  const fixture = fileURLToPath(new URL('./import-crash.fixture.ts', import.meta.url));
  const child = spawn(process.execPath, ['--import', 'tsx', fixture, phase, root], {
    cwd: dirname(dirname(dirname(fixture))),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  return child;
}

function waitFor(child: ChildProcess, match: RegExp, timeoutMs = 60_000): Promise<RegExpMatchArray> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(
      () => reject(new Error(`timed out; stdout=${stdout} stderr=${stderr}`)),
      timeoutMs,
    );
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      const found = stdout.match(match);
      if (found) {
        clearTimeout(timer);
        resolve(found);
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    child.once('exit', (code, signal) => {
      if (match.test(stdout)) return;
      clearTimeout(timer);
      reject(new Error(`child exited (${code ?? signal}); stderr=${stderr}`));
    });
  });
}

const exited = (child: ChildProcess): Promise<void> =>
  child.exitCode !== null || child.signalCode !== null
    ? Promise.resolve()
    : new Promise((resolve) => child.once('exit', () => resolve()));

describe.skipIf(process.platform === 'win32')('SIGKILL during a Library import (F-LIB-04, F-70)', () => {
  it('leaves no partial sidecar, keeps the ids already written, and the next import completes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kilnry-import-crash-'));
    roots.push(root);
    const first = launch('import', root);
    await waitFor(first, /INDEXED 12\n/);
    expect(first.kill('SIGKILL')).toBe(true);
    await exited(first);

    const folder = join(root, 'library', 'Renders');
    // Every sidecar on disk parses: the write is a temporary file and a rename.
    const sidecars = readdirSync(folder).filter((name) => name.endsWith('.png.kilnry.json'));
    expect(sidecars.length).toBeGreaterThanOrEqual(12);
    const before = new Map<string, string>();
    for (const name of sidecars) {
      const parsed = JSON.parse(readFileSync(join(folder, name), 'utf8')) as { asset_id: string };
      before.set(name.replace(/\.kilnry\.json$/, ''), parsed.asset_id);
    }

    const second = launch('resume', root);
    const [, json] = (await waitFor(second, /RESULT (.+)\n/)) as unknown as [string, string];
    const result = JSON.parse(json) as {
      report: { scanned: number; errors: unknown[] };
      rows: Array<{ id: string; path: string }>;
      lockFree: boolean;
    };
    await exited(second);

    expect(result.report.errors).toEqual([]);
    expect(result.report.scanned).toBe(40);
    // One row per file, no duplicate paths, nothing indexed from a temp file.
    const paths = result.rows.map((row) => row.path);
    expect(new Set(paths).size).toBe(40);
    expect(paths.every((path) => /^Renders\/render_\d\d\.png$/.test(path))).toBe(true);
    // A file indexed before the kill keeps the id its sidecar recorded.
    for (const [file, id] of before) {
      expect(result.rows.find((row) => row.path === `Renders/${file}`)?.id).toBe(id);
    }
    expect(result.lockFree).toBe(true);
    const finalSidecars = readdirSync(folder).filter((name) => name.endsWith('.png.kilnry.json'));
    expect(finalSidecars).toHaveLength(40);
  }, 120_000);
});

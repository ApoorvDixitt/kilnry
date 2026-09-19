// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { accessSync, constants, existsSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { launcherConfigPath, launcherDataDir } from '../paths.js';
import { platformKey } from '../platform.js';

export interface DoctorCheck {
  id: string;
  group: 'runtime' | 'storage' | 'database' | 'network' | 'providers' | 'media' | 'security' | 'jobs';
  status: 'pass' | 'warn' | 'fail' | 'skip';
  summary: string;
  detail?: string;
  fix?: string;
}

export async function requestReindex(port = Number(process.env.KILNRY_PORT ?? 3123)): Promise<{
  indexed: number;
  recovered_from_embedded: number;
  skipped: number;
}> {
  const url = `http://127.0.0.1:${port}/api/library/reindex`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Origin: `http://127.0.0.1:${port}`,
        'X-Kilnry-Doctor': 'reindex',
      },
      signal: AbortSignal.timeout(10 * 60_000),
    });
  } catch (error) {
    throw new Error(
      `Could not reach the running Kilnry app for reindex: ${error instanceof Error ? error.message : String(error)}. Start Kilnry, then run doctor --reindex again.`,
      { cause: error },
    );
  }
  const body = (await response.json()) as {
    report?: { indexed: number; recovered_from_embedded: number; skipped: number };
    error?: { message?: string };
  };
  if (!response.ok || !body.report) {
    throw new Error(body.error?.message ?? `Reindex failed with HTTP ${response.status}.`);
  }
  return body.report;
}

export function nodeVersionCheck(version = process.versions.node): DoctorCheck {
  const [major = 0, minor = 0] = version.split('.').map(Number);
  const supported = major > 22 || (major === 22 && minor >= 12);
  return {
    id: 'node.version',
    group: 'runtime',
    status: supported ? (major === 24 ? 'pass' : 'warn') : 'fail',
    summary: supported ? `${version} (need >=22.12; 24.x recommended)` : `${version} is too old`,
    ...(supported ? {} : { fix: 'Install Node 24 LTS from nodejs.org.' }),
  };
}

async function portCheck(port: number): Promise<DoctorCheck> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', (error: NodeJS.ErrnoException) => {
      resolve({
        id: 'port.bind',
        group: 'runtime',
        status: error.code === 'EADDRINUSE' ? 'warn' : 'fail',
        summary:
          error.code === 'EADDRINUSE'
            ? `${port} is in use; Kilnry may already be running`
            : `port check failed: ${error.message}`,
        fix: `Open http://127.0.0.1:${port} or stop the process using the port.`,
      });
    });
    server.listen(port, '127.0.0.1', () => {
      server.close(() =>
        resolve({ id: 'port.bind', group: 'runtime', status: 'pass', summary: `${port} is free` }),
      );
    });
  });
}

function dataDirectoryCheck(): DoctorCheck {
  const dataDir = launcherDataDir();
  if (!existsSync(dataDir)) {
    return {
      id: 'datadir.perms',
      group: 'storage',
      status: 'warn',
      summary: `${dataDir} is not created yet`,
    };
  }
  try {
    accessSync(dataDir, constants.R_OK | constants.W_OK);
    const mode = statSync(dataDir).mode & 0o777;
    return {
      id: 'datadir.perms',
      group: 'storage',
      status: mode & 0o077 ? 'warn' : 'pass',
      summary: `${dataDir} is writable (mode ${mode.toString(8)})`,
      ...(mode & 0o077 ? { fix: `Set private permissions: chmod 700 ${dataDir}` } : {}),
    };
  } catch (error) {
    return {
      id: 'datadir.perms',
      group: 'storage',
      status: 'fail',
      summary: `${dataDir} is not readable and writable`,
      detail: error instanceof Error ? error.message : String(error),
      fix: `Fix ownership and run chmod 700 ${dataDir}.`,
    };
  }
}

function ffmpegCheck(): DoctorCheck {
  const result = spawnSync(process.env.KILNRY_FFMPEG ?? 'ffmpeg', ['-version'], { encoding: 'utf8' });
  if (result.status !== 0) {
    return {
      id: 'ffmpeg.binary',
      group: 'media',
      status: 'warn',
      summary: 'ffmpeg not found',
      fix: 'Install FFmpeg 7 or run kilnry doctor --fix when packaged downloads are available.',
    };
  }
  const firstLine = result.stdout.split('\n')[0] ?? 'ffmpeg found';
  const match = /ffmpeg version\s+(\d+(?:\.\d+)?)/i.exec(firstLine);
  const major = Number(match?.[1]?.split('.')[0] ?? 0);
  return { id: 'ffmpeg.binary', group: 'media', status: major >= 7 ? 'pass' : 'warn', summary: firstLine };
}

function libraryCheck(): DoctorCheck {
  const configPath = launcherConfigPath();
  if (!existsSync(configPath))
    return { id: 'library.root', group: 'storage', status: 'warn', summary: 'Library is not configured yet' };
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as { library_root?: string };
    if (!config.library_root)
      return {
        id: 'library.root',
        group: 'storage',
        status: 'warn',
        summary: 'Library is not configured yet',
      };
    accessSync(config.library_root, constants.R_OK | constants.W_OK);
    const marker = join(config.library_root, '.kilnry', 'library.json');
    return {
      id: 'library.root',
      group: 'storage',
      status: existsSync(marker) ? 'pass' : 'warn',
      summary: `${config.library_root} is writable${existsSync(marker) ? '' : '; marker missing'}`,
    };
  } catch (error) {
    return {
      id: 'library.root',
      group: 'storage',
      status: 'fail',
      summary: 'Configured Library is unavailable',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runDoctor(): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [nodeVersionCheck(), dataDirectoryCheck(), libraryCheck(), ffmpegCheck()];
  try {
    checks.push({ id: 'platform.asset', group: 'runtime', status: 'pass', summary: platformKey() });
  } catch (error) {
    checks.push({
      id: 'platform.asset',
      group: 'runtime',
      status: 'fail',
      summary: error instanceof Error ? error.message : String(error),
    });
  }
  checks.push(await portCheck(Number(process.env.KILNRY_PORT ?? 3123)));
  checks.push({
    id: 'net.binding',
    group: 'network',
    status: 'pass',
    summary: process.env.KILNRY_LAN === '1' ? 'LAN access enabled' : 'loopback only',
  });
  return checks;
}

export function printDoctor(checks: DoctorCheck[], json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify({ checks }, null, 2)}\n`);
    return;
  }
  process.stdout.write(`Kilnry doctor · ${process.platform}-${process.arch}\n\n`);
  for (const check of checks) {
    const glyph =
      check.status === 'pass' ? '✓' : check.status === 'fail' ? '✗' : check.status === 'warn' ? '!' : '–';
    process.stdout.write(`${glyph} ${check.id.padEnd(20)} ${check.summary}\n`);
    if (check.fix) process.stdout.write(`  ${check.fix}\n`);
  }
  const failures = checks.filter((check) => check.status === 'fail').length;
  const warnings = checks.filter((check) => check.status === 'warn').length;
  process.stdout.write(
    `\n${failures} failure${failures === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}.\n`,
  );
}

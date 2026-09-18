// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { KilnryConfigSchema, type KilnryConfig } from './schema.js';

export function defaultDataDir(): string {
  return resolve(/* turbopackIgnore: true */ process.env.KILNRY_DATA_DIR ?? join(homedir(), '.kilnry'));
}

export function defaultLibraryRoot(): string {
  return resolve(/* turbopackIgnore: true */ process.env.KILNRY_LIBRARY_ROOT ?? join(homedir(), 'Kilnry'));
}

export function configPath(dataDir = defaultDataDir()): string {
  return join(dataDir, 'config.json');
}

export function ensureDataDir(dataDir = defaultDataDir()): void {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  chmodSync(dataDir, 0o700);
  for (const child of ['cache', 'identities', 'logs', 'presets', 'skills', 'tmp', 'workflows']) {
    mkdirSync(join(/* turbopackIgnore: true */ dataDir, child), { recursive: true, mode: 0o700 });
  }
}

export function loadConfig(dataDir = defaultDataDir()): KilnryConfig {
  const building = process.env.NEXT_PHASE === 'phase-production-build';
  if (!building) ensureDataDir(dataDir);
  const path = configPath(dataDir);
  const disk = !building && existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as unknown) : {};
  return KilnryConfigSchema.parse({
    ...((typeof disk === 'object' && disk !== null ? disk : {}) as Record<string, unknown>),
    data_dir: dataDir,
    ...(process.env.KILNRY_PORT ? { port: Number(process.env.KILNRY_PORT) } : {}),
    ...(process.env.KILNRY_HOST ? { host: process.env.KILNRY_HOST } : {}),
    ...(process.env.KILNRY_LIBRARY_ROOT ? { library_root: resolve(process.env.KILNRY_LIBRARY_ROOT) } : {}),
    ...(process.env.KILNRY_LAN ? { lan_enabled: process.env.KILNRY_LAN === '1' } : {}),
  });
}

export function saveConfig(config: KilnryConfig): void {
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    throw new Error('Refusing to write Kilnry configuration during a production build.');
  }
  const parsed = KilnryConfigSchema.parse(config);
  ensureDataDir(parsed.data_dir);
  const path = configPath(parsed.data_dir);
  const temporary = join(dirname(path), `.config-${process.pid}.tmp`);
  writeFileSync(temporary, `${JSON.stringify(parsed, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
  chmodSync(path, 0o600);
}

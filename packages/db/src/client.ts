// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { NodeFS } from '@electric-sql/pglite/nodefs';
import { drizzle } from 'drizzle-orm/pglite';
import { schema } from './schema/index.js';
import { acquireDataDirLock } from './lock.js';

export interface DatabaseState {
  client: PGlite;
  db: ReturnType<typeof drizzle<typeof schema>>;
  dataDir: string;
  ready: Promise<void>;
  // Lets go of the data-directory lock; set for a file-backed database only.
  releaseLock?: () => void;
}

export function createDatabase(dataDir: string, options: { memory?: boolean } = {}): DatabaseState {
  const building = process.env.NEXT_PHASE === 'phase-production-build';
  const dbDir = `${dataDir}/kilnry.pglite`;
  if (!building && !options.memory) mkdirSync(dbDir, { recursive: true, mode: 0o700 });
  // Refuse the directory before PGlite touches it when another process holds
  // it (F-101): two openers silently lose each other's committed rows.
  const releaseLock = building || options.memory ? undefined : acquireDataDirLock(dataDir);
  let client: PGlite;
  try {
    client =
      building || options.memory
        ? new PGlite()
        : new PGlite({ fs: new NodeFS(dbDir), relaxedDurability: false });
  } catch (error) {
    releaseLock?.();
    throw error;
  }
  const db = drizzle(client, { schema });
  const ready = client.waitReady.then(() => applyMigrations(client));
  // Neutralise the readiness chain's own rejection at creation. A boot that
  // aborts — which the embedded WebAssembly module does when a second instance is
  // booted in a process that has torn one down, as the Next dev server can do by
  // re-evaluating this module on a hot reload — otherwise becomes an unhandled
  // "RuntimeError: Aborted()" rejection with no awaiter, which floods the dev log.
  // A caller that needs to know the boot failed still awaits `ready` and sees the
  // rejection; this only stops the unawaited copy from surfacing as unhandled.
  void ready.catch(() => undefined);
  return releaseLock ? { client, db, dataDir, ready, releaseLock } : { client, db, dataDir, ready };
}

// Closing while the instance is still serving a query aborts the embedded
// Postgres WebAssembly module: the abort surfaces as an unhandled
// "RuntimeError: Aborted()" or, on a file-backed instance, as "unexpected data
// beyond EOF" the next time a buffer is extended. So closing is single-shot, and
// the readiness chain's own rejection is neutralised rather than awaited — waiting
// on it would make the caller block on, and re-raise, a boot that already failed.
const closed = new WeakSet<PGlite>();

export async function closeDatabaseState(state: DatabaseState): Promise<void> {
  if (closed.has(state.client)) return;
  closed.add(state.client);
  void state.ready.catch(() => undefined);
  try {
    await state.client.close();
  } finally {
    state.releaseLock?.();
  }
}

type GlobalDatabase = typeof globalThis & { __kilnryDatabase?: DatabaseState };

function migrationDirectory(): string {
  return join(/* turbopackIgnore: true */ dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
}

async function applyMigrations(client: PGlite): Promise<void> {
  await client.exec(`
    create table if not exists _kilnry_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    );
  `);
  const directory = migrationDirectory();
  if (!existsSync(directory)) throw new Error(`Migration directory not found: ${directory}`);
  const files = readdirSync(directory)
    .filter((file) => file.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right));
  for (const file of files) {
    const rows = await client.query<{ name: string }>('select name from _kilnry_migrations where name = $1', [
      file,
    ]);
    if (rows.rows.length > 0) continue;
    const sql = readFileSync(join(/* turbopackIgnore: true */ directory, file), 'utf8');
    await client.transaction(async (transaction) => {
      await transaction.exec(sql);
      await transaction.query('insert into _kilnry_migrations(name) values ($1)', [file]);
    });
  }
}

export function database(dataDir = process.env.KILNRY_DATA_DIR ?? '.dev/kilnry'): DatabaseState {
  const global = globalThis as GlobalDatabase;
  if (global.__kilnryDatabase) {
    if (global.__kilnryDatabase.dataDir !== dataDir) {
      throw new Error(
        `Database already opened at ${global.__kilnryDatabase.dataDir}; refusing a second PGlite data directory.`,
      );
    }
    return global.__kilnryDatabase;
  }
  const state = createDatabase(dataDir);
  global.__kilnryDatabase = state;
  return state;
}

export async function closeDatabase(): Promise<void> {
  const global = globalThis as GlobalDatabase;
  const state = global.__kilnryDatabase;
  if (!state) return;
  delete global.__kilnryDatabase;
  await closeDatabaseState(state);
}

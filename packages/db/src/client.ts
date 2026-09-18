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

export interface DatabaseState {
  client: PGlite;
  db: ReturnType<typeof drizzle<typeof schema>>;
  dataDir: string;
  ready: Promise<void>;
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
  const building = process.env.NEXT_PHASE === 'phase-production-build';
  const dbDir = `${dataDir}/kilnry.pglite`;
  if (!building) mkdirSync(dbDir, { recursive: true, mode: 0o700 });
  const client = building ? new PGlite() : new PGlite({ fs: new NodeFS(dbDir), relaxedDurability: false });
  const db = drizzle(client, { schema });
  const ready = client.waitReady.then(() => applyMigrations(client));
  const state: DatabaseState = { client, db, dataDir, ready };
  global.__kilnryDatabase = state;
  return state;
}

export async function closeDatabase(): Promise<void> {
  const global = globalThis as GlobalDatabase;
  const state = global.__kilnryDatabase;
  if (!state) return;
  await state.client.close();
  delete global.__kilnryDatabase;
}

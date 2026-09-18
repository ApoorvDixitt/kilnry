// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDatabase, database } from './client.js';

const dataDir = mkdtempSync(join(tmpdir(), 'kilnry-db-'));

afterAll(async () => {
  await closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('database migrations', () => {
  it('creates every canonical application table', async () => {
    const state = database(dataDir);
    await state.ready;
    const result = await state.client.query<{ count: number }>(
      `select count(*)::int as count from information_schema.tables where table_schema = 'public' and table_name <> '_kilnry_migrations'`,
    );
    expect(result.rows[0]?.count).toBe(36);
  });
});

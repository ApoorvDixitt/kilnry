// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// D-73a: `settings.price_max_age_days` (PRD-14 §8: 30, default; adjustable) is
// the stored threshold the engine reads on every estimate. It did not exist as a
// setting — the estimator and the enforcer both hard-coded 30 — so neither
// Settings › Providers nor the acceptance harness could change it, and every
// shard priced the bundled seed against the real clock.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDatabaseState, createDatabase, settings } from '@kilnry/db';
import { PRICE_MAX_AGE_SETTING, priceMaxAgeDays } from '@kilnry/core';
import { eq } from 'drizzle-orm';

const harness = vi.hoisted(() => ({ services: undefined as unknown }));

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('../../../../server/http', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../server/http')>();
  return { ...original, requireSession: async () => ({ user: { id: 'owner' }, session: { id: 'session' } }) };
});
vi.mock('../../../../server/runtime', () => ({ runtimeServices: async () => harness.services }));

import { GET, PUT } from './route';

let database: ReturnType<typeof createDatabase>;
let root: string;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'kilnry-settings-providers-'));
  database = createDatabase(join(root, 'data'), { memory: true });
  await database.ready;
  harness.services = { database };
}, 60_000);

afterAll(async () => {
  await closeDatabaseState(database);
  rmSync(root, { recursive: true, force: true });
}, 30_000);

function put(body: unknown): Promise<Response> {
  return PUT(
    new Request('http://127.0.0.1:3123/api/settings/providers', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

describe('PUT /api/settings/providers (F-PRV-07)', () => {
  it('reads the default until a value is stored, then stores and returns it', async () => {
    const before = (await (await GET()).json()) as { providers: { price_max_age_days: number } };
    expect(before.providers.price_max_age_days).toBe(30);

    const saved = await put({ price_max_age_days: 3650 });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ providers: { price_max_age_days: 3650 } });

    const row = await database.db.select().from(settings).where(eq(settings.key, PRICE_MAX_AGE_SETTING));
    expect(row[0]?.value).toBe(3650);
    // The engine's own reader sees the same figure.
    expect(await priceMaxAgeDays(database)).toBe(3650);

    // The scenario's end of the range, and an overwrite of the stored row.
    expect(await (await put({ price_max_age_days: 1 })).json()).toEqual({
      providers: { price_max_age_days: 1 },
    });
    expect(await priceMaxAgeDays(database)).toBe(1);
  });

  it('refuses a value outside the PRD range', async () => {
    expect((await put({ price_max_age_days: 0 })).status).toBe(400);
    expect((await put({ price_max_age_days: 3651 })).status).toBe(400);
    // The stored value is untouched by a refused write.
    expect(await priceMaxAgeDays(database)).toBe(1);
  });
});

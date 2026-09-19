// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { budgets, closeDatabaseState, createDatabase, spendLedger } from '@kilnry/db';
import { budgetStatus, reserveBudget } from './enforcer.js';
import { ulid } from '../ids.js';

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose();
});

async function db(): Promise<Awaited<ReturnType<typeof createDatabase>>> {
  const dir = mkdtempSync(join(tmpdir(), 'kilnry-budget-'));
  const state = createDatabase(dir, { memory: true });
  disposers.push(async () => {
    await closeDatabaseState(state);
    rmSync(dir, { recursive: true, force: true });
  });
  await state.ready;
  return state;
}

describe('budgetStatus', () => {
  it('reports a daily cap with the amount already spent', async () => {
    const state = await db();
    await state.db.insert(budgets).values({ scope: 'daily', capUsd: '10', behavior: 'block' });
    await state.db
      .insert(spendLedger)
      .values({ id: ulid(), actualUsd: '3.20', occurredAt: new Date(), providerId: 'fal' });
    const lines = await budgetStatus(state.db);
    const daily = lines.find((line) => line.scope === 'daily');
    expect(daily).toMatchObject({ cap_usd: 10, behavior: 'block' });
    expect(daily?.spent_usd).toBeCloseTo(3.2, 2);
  });

  it('omits scopes with no cap set', async () => {
    const state = await db();
    const lines = await budgetStatus(state.db);
    expect(lines).toHaveLength(0);
  });
});

describe('reserveBudget', () => {
  it('blocks a spend that would exceed a block cap', async () => {
    const state = await db();
    await state.db.insert(budgets).values({ scope: 'daily', capUsd: '5', behavior: 'block' });
    await state.db
      .insert(spendLedger)
      .values({ id: ulid(), actualUsd: '4.80', occurredAt: new Date(), providerId: 'fal' });
    await expect(
      reserveBudget(state.db, { estimate_usd: 0.5, provider: 'fal', folder: 'inbox' }),
    ).rejects.toThrow(/cap .* reached/);
  });

  it('allows the same spend when override is set', async () => {
    const state = await db();
    await state.db.insert(budgets).values({ scope: 'daily', capUsd: '5', behavior: 'block' });
    await state.db
      .insert(spendLedger)
      .values({ id: ulid(), actualUsd: '4.80', occurredAt: new Date(), providerId: 'fal' });
    await expect(
      reserveBudget(state.db, {
        estimate_usd: 0.5,
        provider: 'fal',
        folder: 'inbox',
        override_budget: true,
      }),
    ).resolves.toBeUndefined();
  });
});

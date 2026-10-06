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
    // The migration seeds the $10/day and $100/month defaults (F-08); this
    // test sets its own cap on an otherwise cap-free database.
    await state.db.delete(budgets);
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
    // The user blanks both seeded caps in Settings › Budget ("blank = no cap"),
    // which stores a null cap rather than deleting the row.
    await state.db.update(budgets).set({ capUsd: null });
    const lines = await budgetStatus(state.db);
    expect(lines).toHaveLength(0);
  });
});

describe('reserveBudget', () => {
  it('blocks a spend that would exceed a block cap', async () => {
    const state = await db();
    // The migration seeds the $10/day and $100/month defaults (F-08); this
    // test sets its own cap on an otherwise cap-free database.
    await state.db.delete(budgets);
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
    // The migration seeds the $10/day and $100/month defaults (F-08); this
    // test sets its own cap on an otherwise cap-free database.
    await state.db.delete(budgets);
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

// F-08: PRD-14 promises a $10.00 daily and a $100.00 monthly cap by default; a
// fresh install had no budgets rows, so no cap check ever ran.
describe('the default caps on a fresh database (F-08, F-PRV-04)', () => {
  it('a fresh database has the $10.00 daily and $100.00 monthly blocking caps', async () => {
    const state = await db();
    const lines = await budgetStatus(state.db);
    expect(lines.map(({ scope, cap_usd, behavior }) => ({ scope, cap_usd, behavior }))).toEqual([
      { scope: 'daily', cap_usd: 10, behavior: 'block' },
      { scope: 'monthly', cap_usd: 100, behavior: 'block' },
    ]);
  });

  it('a fresh database refuses a spend past the default daily cap', async () => {
    const state = await db();
    await state.db
      .insert(spendLedger)
      .values({ id: ulid(), actualUsd: '9.900000', occurredAt: new Date(), providerId: 'fal' });
    await expect(
      reserveBudget(state.db, { estimate_usd: 0.2, provider: 'fal', folder: 'inbox' }),
    ).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
  });
});

// F-25: a folder cap matched `LIKE 'inbox%'`, so inbox_archive, inbox2 and
// inboxed/… all spent the inbox cap — and an underscore in a folder name was an
// unescaped single-character wildcard. PRD-14:172 scopes the cap to the folder.
describe('a per-folder cap (F-PRV-04)', () => {
  it('counts the folder and its descendants, never a sibling that starts the same way', async () => {
    const state = await db();
    await state.db.delete(budgets);
    await state.db.insert(budgets).values({ scope: 'folder:inbox', capUsd: '1.00', behavior: 'block' });
    const spend = async (folder: string, usd: string): Promise<void> => {
      await state.db.insert(spendLedger).values({
        id: ulid(),
        jobId: null,
        providerId: 'fal',
        modelId: 'fal-ai/example',
        folder,
        estimateUsd: usd,
        actualUsd: usd,
        occurredAt: new Date(),
      });
    };
    await spend('inbox', '0.10');
    await spend('inbox/Client_A', '0.20');
    await spend('inbox_archive', '0.60');
    await spend('inboxed', '0.50');
    const lines = await budgetStatus(state.db);
    const folderLine = lines.find((line) => line.scope === 'folder');
    expect(folderLine?.label).toBe('inbox');
    // 0.10 + 0.20 only: the two siblings are a different folder's money.
    expect(folderLine?.spent_usd).toBeCloseTo(0.3, 6);
  });
});

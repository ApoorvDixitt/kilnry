// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDatabaseState, createDatabase, spendLedger } from '@kilnry/db';
import { ulid } from '../ids.js';
import { spendLedgerCsv, spendLedgerEntries, spendLedgerGrouped } from './spend-ledger.js';

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose();
});

async function fixture(): Promise<ReturnType<typeof createDatabase>> {
  const dataDir = mkdtempSync(join(tmpdir(), 'kilnry-ledger-'));
  const state = createDatabase(dataDir, { memory: true });
  disposers.push(async () => {
    await closeDatabaseState(state);
    rmSync(dataDir, { recursive: true, force: true });
  });
  await state.ready;
  const day = new Date('2026-09-20T12:00:00.000Z');
  await state.db.insert(spendLedger).values([
    {
      id: ulid(),
      jobId: 'j1',
      providerId: 'fal',
      modelId: 'fal-ai/flux-2/klein/4b',
      folder: 'inbox',
      characterIds: ['maya'],
      kind: 'image',
      estimateUsd: '0.014000',
      actualUsd: '0.014000',
      currencyNote: null,
      occurredAt: day,
    },
    {
      id: ulid(),
      jobId: 'j2',
      providerId: 'fal',
      modelId: 'fal-ai/flux-2/klein/4b',
      folder: 'inbox',
      characterIds: ['maya', 'chai'],
      kind: 'image',
      estimateUsd: '0.020000',
      actualUsd: '0.018000',
      currencyNote: null,
      occurredAt: day,
    },
    {
      id: ulid(),
      jobId: 'j3',
      providerId: 'openrouter',
      modelId: 'bytedance/seedream-4.5',
      folder: 'ads',
      characterIds: [],
      kind: 'image',
      estimateUsd: '0.030000',
      actualUsd: '0.030000',
      currencyNote: null,
      occurredAt: day,
    },
  ]);
  return state;
}

const range = { from: new Date('2026-09-01T00:00:00.000Z'), to: new Date('2026-09-30T23:59:59.000Z') };

describe('spend ledger (F-PRV-05)', () => {
  it('groups spend by provider heaviest first', async () => {
    const state = await fixture();
    const groups = await spendLedgerGrouped(state, { ...range, group_by: 'provider' });
    expect(groups.map((group) => group.key)).toEqual(['fal', 'openrouter']);
    expect(groups[0]?.jobs).toBe(2);
    expect(groups[0]?.actual_usd).toBeCloseTo(0.032, 4);
    expect(groups[0]?.delta_usd).toBeCloseTo(-0.002, 4);
  });

  it('groups spend by character, counting a job under each of its characters', async () => {
    const state = await fixture();
    const groups = await spendLedgerGrouped(state, { ...range, group_by: 'character' });
    const maya = groups.find((group) => group.key === 'maya');
    expect(maya?.jobs).toBe(2);
    const chai = groups.find((group) => group.key === 'chai');
    expect(chai?.jobs).toBe(1);
  });

  it('exports one CSV row per job with the fixed columns and four-decimal costs', async () => {
    const state = await fixture();
    const rows = await spendLedgerEntries(state, range);
    const csv = spendLedgerCsv(rows);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe(
      'occurred_at,job_id,source,provider,model,kind,folder,characters,estimate_usd,actual_usd,currency_note,provider_request_id',
    );
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain('0.0140,0.0140');
    expect(lines[2]).toContain('0.0200,0.0180');
  });
});

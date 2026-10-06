// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// F-33: PRD-16:293 says the audit log records key add/remove/reveal, token
// create/revoke, the LAN toggle, budget changes and recovery-kit view or
// regenerate. Only the LAN toggle was written, so the log could not answer who
// changed a spend cap, minted a token or looked at the recovery kit.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { auditEvents, closeDatabaseState, createDatabase } from '@kilnry/db';
import { eq } from 'drizzle-orm';

const harness = vi.hoisted(() => ({ services: undefined as unknown }));

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('../../../server/http', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../server/http')>();
  return { ...original, requireSession: async () => ({ user: { id: 'owner' }, session: { id: 'session' } }) };
});
vi.mock('../../../server/runtime', () => ({ runtimeServices: async () => harness.services }));

import { PUT as putBudget } from './route';

let database: ReturnType<typeof createDatabase>;
let root: string;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'kilnry-budget-audit-'));
  database = createDatabase(join(root, 'data'), { memory: true });
  await database.ready;
  harness.services = { database };
}, 60_000);

afterAll(async () => {
  await closeDatabaseState(database);
  rmSync(root, { recursive: true, force: true });
}, 30_000);

describe('PUT /api/budget (F-SET-08)', () => {
  it('records a cap change in the audit log', async () => {
    const response = await putBudget(
      new Request('http://127.0.0.1:3123/api/budget', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'daily', cap_usd: 25, behavior: 'ask' }),
      }),
    );
    expect(response.status).toBe(200);
    const rows = await database.db.select().from(auditEvents).where(eq(auditEvents.action, 'budget.set'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: 'user', target: 'daily' });
    expect(rows[0]?.meta).toMatchObject({ cap_usd: 25, behavior: 'ask' });
  });
});

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// F-121: "Save chat settings" failed with a 500 whenever the session budget was
// left on its default, because the page sends it as null.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDatabaseState, createDatabase, settings } from '@kilnry/db';
import { eq } from 'drizzle-orm';

const harness = vi.hoisted(() => ({ services: undefined as unknown }));

vi.mock('../../../../server/http', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../server/http')>();
  return { ...original, requireSession: async () => ({ user: { id: 'owner' }, session: { id: 'session' } }) };
});
vi.mock('../../../../server/runtime', () => ({ runtimeServices: async () => harness.services }));

import { PUT } from './route';

let database: ReturnType<typeof createDatabase>;
let root: string;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'kilnry-settings-chat-'));
  database = createDatabase(join(root, 'data'), { memory: true });
  await database.ready;
  harness.services = { database };
}, 60_000);

afterAll(async () => {
  await closeDatabaseState(database);
  rmSync(root, { recursive: true, force: true });
}, 30_000);

describe('PUT /api/settings/chat (F-121)', () => {
  it('saves with the session budget left on its default (null) and clears it back to the default', async () => {
    const response = await PUT(
      new Request('http://127.0.0.1:3123/api/settings/chat', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          default_llm: { provider: 'openrouter', model: 'anthropic/claude-sonnet-5' },
          autonomy: 'ask_first',
          session_budget_usd: null,
        }),
      }),
    );
    expect(response.status).toBe(200);
    const llm = await database.db.select().from(settings).where(eq(settings.key, 'chat.default_llm'));
    expect(llm[0]?.value).toEqual({ provider: 'openrouter', model: 'anthropic/claude-sonnet-5' });
    // The seeded $5.00 is removed, so the session default applies again.
    const budget = await database.db
      .select()
      .from(settings)
      .where(eq(settings.key, 'chat.session_budget_usd'));
    expect(budget).toHaveLength(0);
  });
});

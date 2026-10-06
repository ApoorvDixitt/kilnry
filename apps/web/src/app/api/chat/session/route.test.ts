// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// F-115: the Chat page can change autonomy before its first message has created
// the session row; the PUT must create it rather than update nothing.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { chatSessions, closeDatabaseState, createDatabase } from '@kilnry/db';
import { eq } from 'drizzle-orm';

const harness = vi.hoisted(() => ({ services: undefined as unknown }));

vi.mock('../../../../server/http', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../server/http')>();
  return { ...original, requireSession: async () => ({ user: { id: 'owner' }, session: { id: 'session' } }) };
});
vi.mock('../../../../server/runtime', () => ({ runtimeServices: async () => harness.services }));

import { PUT } from './route';
import { GET as listSessions } from '../sessions/route';

let database: ReturnType<typeof createDatabase>;
let root: string;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'kilnry-chat-session-'));
  database = createDatabase(join(root, 'data'), { memory: true });
  await database.ready;
  harness.services = { database };
}, 60_000);

afterAll(async () => {
  await closeDatabaseState(database);
  rmSync(root, { recursive: true, force: true });
}, 30_000);

function put(body: Record<string, unknown>): Promise<Response> {
  return PUT(
    new Request('http://127.0.0.1:3123/api/chat/session', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

describe('PUT /api/chat/session (F-115, F-104)', () => {
  it('creates the session from the defaults when the page switches autonomy before any message', async () => {
    const response = await put({ session_id: 'session-before-post', autonomy: 'run_automatically' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      session: {
        id: 'session-before-post',
        autonomy: 'run_automatically',
        budget_usd: 5,
        auto_approve_below_usd: 0.5,
      },
    });
    const listed = (await (
      await listSessions(new Request('http://127.0.0.1:3123/api/chat/sessions'))
    ).json()) as {
      sessions: Array<{ id: string }>;
    };
    expect(listed.sessions.map((session) => session.id)).toContain('session-before-post');
    const row = (
      await database.db.select().from(chatSessions).where(eq(chatSessions.id, 'session-before-post'))
    )[0];
    expect(row?.autonomy).toBe('run_automatically');
  });

  it('updates an existing session and keeps what the patch does not name', async () => {
    await put({ session_id: 'session-existing', budget_usd: 2 });
    const response = await put({ session_id: 'session-existing', autonomy: 'run_automatically' });
    expect(((await response.json()) as { session: Record<string, unknown> }).session).toMatchObject({
      autonomy: 'run_automatically',
      budget_usd: 2,
    });
  });
});

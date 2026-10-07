// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// F-76: Settings › Security's Revoke deleted better-auth's session row itself.
// It ended the session only because better-auth's cookie cache is off by
// default (`cookieCache?.enabled === true`, better-auth 1.7.5
// dist/api/routes/session.mjs:39); it now goes through the library's own
// revokeSession. This drives a real better-auth instance on a throwaway data
// directory: two sign-ins, one revoked from the other.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({ cookie: '', services: undefined as unknown }));

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ cookie: harness.cookie, host: '127.0.0.1:3123' }),
}));
vi.mock('../../../../server/runtime', () => ({
  startRuntime: async () => {},
  runtimeServices: async () => harness.services,
}));

const root = mkdtempSync(join(tmpdir(), 'kilnry-sessions-'));
process.env.KILNRY_DATA_DIR = join(root, 'data');
process.env.KILNRY_PORT = '3123';

const { database } = await import('@kilnry/db');
const { getAuth } = await import('../../../../server/auth');
const { DELETE } = await import('./route');

const EMAIL = 'owner@example.test';
const PASSWORD = 'correct horse battery';

async function signIn(): Promise<{ cookie: string; token: string }> {
  const response = await getAuth().api.signInEmail({
    body: { email: EMAIL, password: PASSWORD },
    asResponse: true,
  });
  const setCookie = response.headers.getSetCookie().find((value) => value.includes('session_token='));
  if (!setCookie) throw new Error('sign-in set no session cookie');
  const cookie = setCookie.split(';')[0]!;
  const token = decodeURIComponent(cookie.split('=')[1]!).split('.')[0]!;
  return { cookie, token };
}

async function sessionFor(cookie: string): Promise<unknown> {
  return getAuth().api.getSession({ headers: new Headers({ cookie }) });
}

beforeAll(async () => {
  const state = database(process.env.KILNRY_DATA_DIR!);
  await state.ready;
  harness.services = { database: state };
  await getAuth().api.signUpEmail({ body: { email: EMAIL, password: PASSWORD, name: 'owner' } });
}, 60_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('DELETE /api/security/sessions (F-SET-08, F-76)', () => {
  it('revokes another session through better-auth and leaves the caller signed in', async () => {
    const mine = await signIn();
    const other = await signIn();
    expect(await sessionFor(other.cookie)).not.toBeNull();

    const { sessions } = await import('@kilnry/db');
    const { eq } = await import('drizzle-orm');
    const state = (harness.services as { database: ReturnType<typeof database> }).database;
    const [row] = await state.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.token, other.token));
    expect(row).toBeDefined();

    const revoke = vi.spyOn(getAuth().api, 'revokeSession');
    harness.cookie = mine.cookie;
    const response = await DELETE(
      new Request('http://127.0.0.1:3123/api/security/sessions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', cookie: mine.cookie },
        body: JSON.stringify({ session_id: row!.id }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, current_revoked: false });

    // Through the library, with the revoked session's token.
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke.mock.calls[0]?.[0]).toMatchObject({ body: { token: other.token } });
    expect(await sessionFor(other.cookie)).toBeNull();
    expect(await sessionFor(mine.cookie)).not.toBeNull();
  });

  it('refuses a session id the caller does not own', async () => {
    const mine = await signIn();
    harness.cookie = mine.cookie;
    const response = await DELETE(
      new Request('http://127.0.0.1:3123/api/security/sessions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', cookie: mine.cookie },
        body: JSON.stringify({ session_id: 'no-such-session' }),
      }),
    );
    expect(response.status).toBe(404);
  });
});

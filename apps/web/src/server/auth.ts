// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { APIError } from 'better-auth/api';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { defaultDataDir, ensureDataDir } from '@kilnry/core/config';
import { ulid } from '@kilnry/core/ids';
import { accounts, database, sessions, users, verifications } from '@kilnry/db';

function authSecret(): string {
  if (process.env.BETTER_AUTH_SECRET) return process.env.BETTER_AUTH_SECRET;
  if (process.env.NEXT_PHASE === 'phase-production-build') return randomBytes(32).toString('base64url');
  const dataDir = defaultDataDir();
  ensureDataDir(dataDir);
  const path = join(dataDir, 'auth.secret');
  if (!existsSync(path)) {
    writeFileSync(path, `${randomBytes(32).toString('base64url')}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    chmodSync(path, 0o600);
  }
  return readFileSync(path, 'utf8').trim();
}

const dataDir = defaultDataDir();
const state = database(dataDir);
const port = Number(process.env.KILNRY_PORT ?? process.env.PORT ?? 3123);

export const auth = betterAuth({
  appName: 'Kilnry',
  baseURL: `http://127.0.0.1:${port}`,
  secret: authSecret(),
  trustedOrigins: [`http://127.0.0.1:${port}`, `http://localhost:${port}`],
  database: drizzleAdapter(state.db, {
    provider: 'pg',
    schema: { account: accounts, session: sessions, user: users, verification: verifications },
  }),
  emailAndPassword: {
    autoSignIn: true,
    enabled: true,
    maxPasswordLength: 128,
    minPasswordLength: 10,
    requireEmailVerification: false,
  },
  advanced: {
    database: { generateId: () => ulid() },
    useSecureCookies: process.env.KILNRY_TLS === '1',
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          await state.ready;
          const existing = await state.db.select({ id: users.id }).from(users).limit(1);
          if (existing.length > 0) {
            throw new APIError('BAD_REQUEST', {
              message: 'This Kilnry install already has a local account.',
            });
          }
          return { data: user };
        },
      },
    },
  },
});

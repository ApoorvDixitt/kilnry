// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { eq } from 'drizzle-orm';
import { database } from './client.js';
import { settings, users } from './schema/index.js';

export async function hasLocalUser(dataDir?: string): Promise<boolean> {
  const state = database(dataDir);
  await state.ready;
  const rows = await state.db.select({ id: users.id }).from(users).limit(1);
  return rows.length > 0;
}

export async function getSetting<T>(key: string, dataDir?: string): Promise<T | undefined> {
  const state = database(dataDir);
  await state.ready;
  const rows = await state.db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1);
  return rows[0]?.value as T | undefined;
}

export async function putSetting(key: string, value: unknown, dataDir?: string): Promise<void> {
  const state = database(dataDir);
  await state.ready;
  await state.db
    .insert(settings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

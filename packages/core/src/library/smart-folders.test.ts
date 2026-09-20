// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDatabaseState, createDatabase } from '@kilnry/db';
import {
  BUILTIN_SMART_FOLDERS,
  createSmartFolder,
  deleteSmartFolder,
  listSmartFolders,
  renameSmartFolder,
} from './smart-folders.js';

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose();
});

async function db(): Promise<Awaited<ReturnType<typeof createDatabase>>> {
  const root = mkdtempSync(join(tmpdir(), 'kilnry-smart-'));
  const state = createDatabase(join(root, 'data'), { memory: true });
  disposers.push(async () => {
    await closeDatabaseState(state);
    rmSync(root, { recursive: true, force: true });
  });
  await state.ready;
  return state;
}

describe('smart folders', () => {
  it('lists the built-ins on a fresh install', async () => {
    const state = await db();
    const folders = await listSmartFolders(state);
    for (const builtin of BUILTIN_SMART_FOLDERS) {
      expect(folders.some((f) => f.id === builtin.id && f.builtin)).toBe(true);
    }
  });

  it('saves a search as a smart folder and lists it', async () => {
    const state = await db();
    const saved = await createSmartFolder(state, 'Client A', '@maya type:video');
    expect(saved).toMatchObject({ name: 'Client A', query: '@maya type:video', builtin: false });
    const folders = await listSmartFolders(state);
    expect(folders.some((f) => f.id === saved.id)).toBe(true);
  });

  it('renames and deletes a user folder but refuses to touch a built-in', async () => {
    const state = await db();
    const saved = await createSmartFolder(state, 'Temp', 'cost>2');
    await renameSmartFolder(state, saved.id, 'Renamed');
    expect((await listSmartFolders(state)).find((f) => f.id === saved.id)?.name).toBe('Renamed');
    await expect(renameSmartFolder(state, 'builtin-today', 'X')).rejects.toThrow(/Built-in/);
    await expect(deleteSmartFolder(state, 'builtin-today')).rejects.toThrow(/Built-in/);
    await deleteSmartFolder(state, saved.id);
    expect((await listSmartFolders(state)).some((f) => f.id === saved.id)).toBe(false);
  });
});

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// F-34: PRD-04:231 checks "Save into a folder" on the first folder the user
// created (not inbox or Trash) OR the first asset moved out of inbox, and
// acceptance 3 says creating a folder in the tree checks it. The item was
// computed from assets alone with `folder_path != 'inbox'`, so creating a folder
// left it unchecked and deleting a file — which moves the asset to Trash/ —
// checked it.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assets, closeDatabaseState, createDatabase, folders } from '@kilnry/db';
import { checklistStatus } from './checklist.js';
import { ulid } from '../ids.js';

const disposers: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
});

async function db(): Promise<ReturnType<typeof createDatabase>> {
  const root = mkdtempSync(join(tmpdir(), 'kilnry-checklist-'));
  const state = createDatabase(join(root, 'data'), { memory: true });
  disposers.push(async () => {
    await closeDatabaseState(state);
    rmSync(root, { recursive: true, force: true });
  });
  await state.ready;
  return state;
}

async function addAsset(
  state: Awaited<ReturnType<typeof db>>,
  folderPath: string,
  trashed: boolean,
): Promise<void> {
  await state.db.insert(assets).values({
    id: ulid(),
    path: `${folderPath}/file-${ulid()}.png`,
    folderPath,
    kind: 'image',
    createdAt: new Date(),
    ...(trashed ? { trashedAt: new Date() } : {}),
  });
}

describe('the first-run checklist (F-ONB-05)', () => {
  it('checks "Save into a folder" when the user creates a folder and no asset has moved', async () => {
    const state = await db();
    expect((await checklistStatus(state)).organise).toBe(false);
    await state.db.insert(folders).values({ path: 'Campaign_A', name: 'Campaign_A' });
    expect((await checklistStatus(state)).organise).toBe(true);
  });

  it('does not check it for a trashed asset', async () => {
    const state = await db();
    await addAsset(state, 'Trash', true);
    expect((await checklistStatus(state)).organise).toBe(false);
    // An asset genuinely moved out of inbox does check it.
    await addAsset(state, 'Campaign_A', false);
    expect((await checklistStatus(state)).organise).toBe(true);
  });

  it('ignores inbox itself and the Trash folder row', async () => {
    const state = await db();
    await state.db.insert(folders).values({ path: 'inbox', name: 'inbox' });
    await state.db.insert(folders).values({ path: 'Trash', name: 'Trash' });
    await addAsset(state, 'inbox', false);
    expect((await checklistStatus(state)).organise).toBe(false);
  });
});

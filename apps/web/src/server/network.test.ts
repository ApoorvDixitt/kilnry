// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// F-39: Chat had two offline signals that disagreed — the prompt read the
// observed network state and the tool gating read `llm.local === true`. A local
// model with the network up therefore lost the cloud spend tools, and a cloud
// model with the network down kept them and called providers that could not
// answer. Both now read this one value, whatever model the turn uses.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDatabaseState, createDatabase } from '@kilnry/db';
import { markNetworkOnline, persistNetworkState } from '@kilnry/core';
import { networkOnline } from './network';

let database: ReturnType<typeof createDatabase>;
let root: string;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'kilnry-network-state-'));
  database = createDatabase(join(root, 'data'), { memory: true });
  await database.ready;
}, 60_000);

afterAll(async () => {
  await closeDatabaseState(database);
  rmSync(root, { recursive: true, force: true });
}, 30_000);

describe('the server network state (F-CHT-11, F40)', () => {
  it('is online until a request fails to reach the network, and offline after', async () => {
    markNetworkOnline();
    expect(await networkOnline(database)).toBe(true);

    await persistNetworkState(database, new Date().toISOString());
    expect(await networkOnline(database)).toBe(false);

    await persistNetworkState(database, null);
    expect(await networkOnline(database)).toBe(true);
  });
});

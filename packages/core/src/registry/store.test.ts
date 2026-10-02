// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDatabaseState, createDatabase } from '@kilnry/db';
import { loadRegistry, seedRegistry } from './store.js';

const disposers: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose();
});

describe('stored registry', () => {
  it('keeps each seeded model ETA, so Trellis estimates ~40 s (F-CRE-15)', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kilnry-registry-store-'));
    const state = createDatabase(dataDir, { memory: true });
    disposers.push(async () => {
      await closeDatabaseState(state);
      rmSync(dataDir, { recursive: true, force: true });
    });
    await state.ready;
    await seedRegistry(state);
    const registry = await loadRegistry(state);
    const find = (id: string) => registry.models.find((model) => model.model_id === id);
    expect(find('fal-ai/trellis')?.eta_s).toBe(40);
    expect(find('fal-ai/trellis')?.capabilities).toEqual(['3d']);
    expect(find('fal-ai/hunyuan3d-v3/image-to-3d')?.price_rule).toMatchObject({ amount: 0.375 });
  });
});

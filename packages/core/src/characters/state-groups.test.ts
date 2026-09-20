// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDatabaseState, createDatabase } from '@kilnry/db';
import { linkStateVariant, listStateGroups, stateGroupFor, suggestStateHandle } from './state-groups.js';

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose();
});

async function db(): Promise<Awaited<ReturnType<typeof createDatabase>>> {
  const root = mkdtempSync(join(tmpdir(), 'kilnry-state-'));
  const state = createDatabase(join(root, 'data'), { memory: true });
  disposers.push(async () => {
    await closeDatabaseState(state);
    rmSync(root, { recursive: true, force: true });
  });
  await state.ready;
  return state;
}

describe('suggestStateHandle', () => {
  it('joins a base handle and a state label', () => {
    expect(suggestStateHandle('hero', 'wet')).toBe('hero_wet');
    expect(suggestStateHandle('@hero', 'Rain Wet')).toBe('hero_rain_wet');
  });
});

describe('state groups', () => {
  it('links variants under a base and finds the group from either handle', async () => {
    const state = await db();
    await linkStateVariant(state, 'hero', 'hero_wet');
    const group = await linkStateVariant(state, 'hero', 'hero_frosted');
    expect(group.base).toBe('hero');
    expect(group.states).toEqual(['hero_wet', 'hero_frosted']);

    const fromBase = await stateGroupFor(state, 'hero');
    const fromVariant = await stateGroupFor(state, '@hero_wet');
    expect(fromBase?.group_id).toBe(group.group_id);
    expect(fromVariant?.group_id).toBe(group.group_id);
  });

  it('never lists the base among its own states and does not duplicate', async () => {
    const state = await db();
    await linkStateVariant(state, 'hero', 'hero');
    await linkStateVariant(state, 'hero', 'hero_wet');
    await linkStateVariant(state, 'hero', 'hero_wet');
    const groups = await listStateGroups(state);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.states).toEqual(['hero_wet']);
  });
});

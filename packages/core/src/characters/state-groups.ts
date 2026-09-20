// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { eq } from 'drizzle-orm';
import { settings, type DatabaseState } from '@kilnry/db';
import { ulid } from '../ids.js';
import { normaliseHandle } from './store.js';

const KEY = 'state_groups';

// A state group links a base Element to its state variants, each of which is its
// own Element with its own handle and files (PRD-08 A2). Example: base @hero with
// states @hero_wet, @hero_frosted.
export interface StateGroup {
  group_id: string;
  base: string;
  states: string[];
}

async function readGroups(db: DatabaseState): Promise<StateGroup[]> {
  const rows = await db.db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, KEY))
    .limit(1);
  const value = rows[0]?.value as StateGroup[] | undefined;
  return Array.isArray(value) ? value : [];
}

async function writeGroups(db: DatabaseState, groups: StateGroup[]): Promise<void> {
  await db.db
    .insert(settings)
    .values({ key: KEY, value: groups, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value: groups, updatedAt: new Date() } });
}

// Suggested state-label suffixes surfaced as chips in the UI (PRD-08 A2).
export const STATE_SUFFIXES = ['dry', 'wet', 'open', 'closed', 'lit', 'day', 'night', 'frosted', 'used'];

// Suggest a variant handle from a base handle and a state label, e.g. @hero + wet
// → hero_wet.
export function suggestStateHandle(baseHandle: string, label: string): string {
  const base = normaliseHandle(baseHandle);
  const suffix = label
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]/g, '');
  return `${base}_${suffix}`.slice(0, 32);
}

// Link a state variant to its base, creating the group on first use. Both handles
// are stored normalised. The base is never listed among its own states.
export async function linkStateVariant(
  db: DatabaseState,
  baseHandle: string,
  variantHandle: string,
): Promise<StateGroup> {
  const base = normaliseHandle(baseHandle);
  const variant = normaliseHandle(variantHandle);
  const groups = await readGroups(db);
  let group = groups.find((g) => g.base === base);
  if (!group) {
    group = { group_id: ulid(), base, states: [] };
    groups.push(group);
  }
  if (variant !== base && !group.states.includes(variant)) group.states.push(variant);
  await writeGroups(db, groups);
  return group;
}

// The state group a handle belongs to, whether it is the base or a variant.
export async function stateGroupFor(db: DatabaseState, handle: string): Promise<StateGroup | undefined> {
  const value = normaliseHandle(handle);
  const groups = await readGroups(db);
  return groups.find((g) => g.base === value || g.states.includes(value));
}

export async function listStateGroups(db: DatabaseState): Promise<StateGroup[]> {
  return readGroups(db);
}

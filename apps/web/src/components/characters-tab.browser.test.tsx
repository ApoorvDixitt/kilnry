// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { filterCards, formatCount, sortCards, type CharacterCard } from './characters-tab-logic';

function card(overrides: Partial<CharacterCard>): CharacterCard {
  return {
    id: crypto.randomUUID(),
    handle: 'maya',
    display_name: 'Maya',
    kind: 'character',
    version: 1,
    tags: [],
    reference_count: 0,
    trained: [],
    is_real_person: false,
    consent_status: 'n/a',
    usage_count: 0,
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('formatCount', () => {
  it('substitutes named placeholders', () => {
    expect(formatCount('{n} uses', { n: 47 })).toBe('47 uses');
  });
});

describe('filterCards', () => {
  it('matches handle, display name and tags, ignoring a leading @', () => {
    const cards = [
      card({ handle: 'maya', display_name: 'Maya Rao', tags: ['role:host'] }),
      card({ handle: 'rohan', display_name: 'Rohan', tags: [] }),
    ];
    expect(filterCards(cards, '@maya').map((c) => c.handle)).toEqual(['maya']);
    expect(filterCards(cards, 'rao').map((c) => c.handle)).toEqual(['maya']);
    expect(filterCards(cards, 'role:host').map((c) => c.handle)).toEqual(['maya']);
    expect(filterCards(cards, '')).toHaveLength(2);
  });
});

describe('sortCards', () => {
  it('sorts by handle, by created and by last use', () => {
    const cards = [
      card({ handle: 'b', updated_at: '2026-01-02T00:00:00.000Z', last_used_at: '2026-02-01T00:00:00.000Z' }),
      card({ handle: 'a', updated_at: '2026-01-03T00:00:00.000Z', last_used_at: '2026-01-01T00:00:00.000Z' }),
    ];
    expect(sortCards(cards, 'name').map((c) => c.handle)).toEqual(['a', 'b']);
    expect(sortCards(cards, 'created').map((c) => c.handle)).toEqual(['a', 'b']);
    expect(sortCards(cards, 'used').map((c) => c.handle)).toEqual(['b', 'a']);
  });
});

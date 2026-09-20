// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Pure helpers for the Characters/Elements grid, kept free of framework imports so
// they can be unit-tested without a browser or router (F-CHR-01).

export interface CharacterCard {
  id: string;
  handle: string;
  display_name: string;
  kind: 'character' | 'prop' | 'environment' | 'style';
  version: number;
  tags: string[];
  anchor_asset_id?: string;
  anchor_preview_url?: string;
  reference_count: number;
  trained: Array<{ provider: string; kind: string; status: string }>;
  voice?: { provider: string; voice_id: string };
  is_real_person: boolean;
  consent_status: string;
  usage_count: number;
  updated_at: string;
  last_used_at?: string;
}

export type CardSort = 'used' | 'name' | 'created';

export function formatCount(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));
}

export function sortCards(cards: CharacterCard[], sort: CardSort): CharacterCard[] {
  const copy = [...cards];
  if (sort === 'name') return copy.sort((a, b) => a.handle.localeCompare(b.handle));
  if (sort === 'created') return copy.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return copy.sort((a, b) => (b.last_used_at ?? '').localeCompare(a.last_used_at ?? ''));
}

export function filterCards(cards: CharacterCard[], query: string): CharacterCard[] {
  const q = query.trim().toLowerCase().replace(/^@/, '');
  if (!q) return cards;
  return cards.filter(
    (c) =>
      c.handle.includes(q) ||
      c.display_name.toLowerCase().includes(q) ||
      c.tags.some((t) => t.toLowerCase().includes(q)),
  );
}

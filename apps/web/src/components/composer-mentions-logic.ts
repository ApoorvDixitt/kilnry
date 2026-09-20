// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Framework-free helpers for the composer's @ mention autocomplete (F-CRE-02),
// unit-tested without a browser.

export interface MentionSuggestion {
  handle: string;
  display_name: string;
  kind: 'character' | 'prop' | 'environment' | 'style';
  version: number;
  thumb_url?: string;
}

export interface ResolvePreview {
  rewritten_prompt: string;
  injections: Array<{
    handle: string;
    version: number;
    strategy: string;
    inputs: Array<{ role: string; asset_id: string }>;
    notes: string[];
  }>;
  warnings: string[];
}

// The @token currently being typed, if the caret sits inside one. Returns the
// query (without the @) and the start offset so an accepted suggestion can
// replace exactly the typed fragment.
export function activeMentionQuery(
  text: string,
  caret: number,
): { query: string; start: number } | undefined {
  const before = text.slice(0, caret);
  const match = /(^|[\s(,"'])@([a-z0-9_-]*)$/i.exec(before);
  if (!match) return undefined;
  const query = match[2] ?? '';
  return { query, start: caret - query.length - 1 };
}

// Replace the active @fragment with the accepted handle plus a trailing space,
// returning the new text and the caret position after the insertion.
export function acceptMention(
  text: string,
  caret: number,
  start: number,
  handle: string,
): { text: string; caret: number } {
  const inserted = `@${handle} `;
  const next = text.slice(0, start) + inserted + text.slice(caret);
  return { text: next, caret: start + inserted.length };
}

// Count the distinct character mentions in a resolve preview (people only), used
// for the three-or-more-people warning (F-CHR-13).
export function distinctPeople(preview: ResolvePreview | undefined): number {
  if (!preview) return 0;
  return new Set(preview.injections.filter((i) => i.strategy !== 'voice_id').map((i) => i.handle)).size;
}

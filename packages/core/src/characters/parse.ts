// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import type { CharacterHead } from './store.js';

// A parsed @handle or <<<ulid>>> mention. One Mention per distinct (id, version)
// with every span offset where it appears; order follows first appearance.
export interface Mention {
  handle: string;
  id: string;
  version?: number;
  spans: Array<{ start: number; end: number; raw: string }>;
}

export interface ParseResult {
  mentions: Mention[];
  warnings: string[];
}

// Grammar (TRD-14 §1):
//   mention := '@' handle ('@v' version)?      user-typed:  @maya  @maya@v2
//   token   := '<<<' ulid ('@v' version)? '>>>'  internal:   <<<01JAK7…>>>
//   handle  := [a-z0-9_-]{2,32}                 case-insensitive on input
//   version := [1-9][0-9]*
// The negative lookahead after a handle rejects an email-like name@domain: an
// address has more word/dot/dash characters followed by another '@' segment.
const MENTION_RE =
  /(^|[\s(,"'])@([a-z0-9_-]{2,32})(?:@v([1-9][0-9]*))?(?![\w.-]*@)|<<<([0-9A-HJKMNP-TV-Z]{26})(?:@v([1-9][0-9]*))?>>>/gi;

// Suggest the closest known handle for an unknown one (single edit distance) so
// the warning can read "did you mean @maya?".
function suggest(handle: string, known: string[]): string | undefined {
  let best: { handle: string; distance: number } | undefined;
  for (const candidate of known) {
    const distance = editDistance(handle, candidate);
    if (distance <= 2 && (!best || distance < best.distance)) best = { handle: candidate, distance };
  }
  return best?.handle;
}

function editDistance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j += 1) rows[0]![j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i]![j] = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost);
    }
  }
  return rows[a.length]![b.length]!;
}

/**
 * Parse @handle and <<<ulid>>> mentions from a prompt. `lookup` resolves a handle
 * (following one alias hop is the caller's job) to a Character head; unknown
 * handles are left as text and reported in `warnings`.
 */
export function parseMentions(
  prompt: string,
  lookup: (handle: string) => CharacterHead | undefined,
  knownHandles: string[] = [],
): ParseResult {
  const byKey = new Map<string, Mention>();
  const warnings: string[] = [];
  const order: string[] = [];
  MENTION_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MENTION_RE.exec(prompt)) !== null) {
    const [, boundary, handleRaw, handleVersion, idRaw, idVersion] = match;
    if (handleRaw) {
      const handle = handleRaw.toLowerCase();
      const start = match.index + (boundary ? boundary.length : 0);
      const raw = prompt.slice(start, match.index + match[0].length);
      const head = lookup(handle);
      if (!head) {
        const hint = suggest(handle, knownHandles);
        warnings.push(
          hint ? `@${handle} is not a Character; did you mean @${hint}?` : `@${handle} is not a Character.`,
        );
        continue;
      }
      const version = handleVersion ? Number(handleVersion) : undefined;
      addSpan(byKey, order, head, version, { start, end: match.index + match[0].length, raw });
    } else if (idRaw) {
      const head = lookup(idRaw);
      const version = idVersion ? Number(idVersion) : undefined;
      const start = match.index;
      const raw = match[0];
      if (head) {
        addSpan(byKey, order, head, version, { start, end: start + raw.length, raw });
      } else {
        // An internal token whose character was deleted: keep the head-less key so
        // the caller can still strip it, but flag it.
        addSpan(
          byKey,
          order,
          {
            id: idRaw,
            handle: idRaw,
            kind: 'character',
            display_name: idRaw,
            current_version: 1,
            is_real_person: false,
            consent_status: 'n/a',
          },
          version,
          { start, end: start + raw.length, raw },
        );
      }
    }
  }
  return { mentions: order.map((key) => byKey.get(key)!), warnings };
}

function addSpan(
  byKey: Map<string, Mention>,
  order: string[],
  head: CharacterHead,
  version: number | undefined,
  span: { start: number; end: number; raw: string },
): void {
  const resolvedVersion = version ?? head.current_version;
  const key = `${head.id}@v${resolvedVersion}`;
  const existing = byKey.get(key);
  if (existing) {
    existing.spans.push(span);
    return;
  }
  order.push(key);
  byKey.set(key, {
    handle: head.handle,
    id: head.id,
    ...(version !== undefined ? { version } : {}),
    spans: [span],
  });
}

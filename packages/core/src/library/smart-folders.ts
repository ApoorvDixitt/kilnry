// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { asc, eq } from 'drizzle-orm';
import { smartFolders, type DatabaseState } from '@kilnry/db';
import { KilnryError } from '../errors.js';
import { ulid } from '../ids.js';

// A smart folder is a saved search shown in the tree; it never holds files
// (F-LIB-07). `query` is the one-line Library search that produces its contents.
export interface SmartFolder {
  id: string;
  name: string;
  query: string;
  builtin: boolean;
  position: number;
}

// The built-in smart folders present after onboarding (PRD-06 §8). "By character"
// is a group the tree expands per character, so it carries no single query here.
export const BUILTIN_SMART_FOLDERS: Array<{ id: string; name: string; query: string }> = [
  { id: 'builtin-all-videos', name: 'All videos', query: 'type:video' },
  { id: 'builtin-today', name: 'Today', query: 'since:24h' },
  { id: 'builtin-over-1', name: 'Over $1', query: 'cost>1' },
  { id: 'builtin-uncategorized', name: 'Uncategorized', query: 'has:nosidecar' },
  { id: 'builtin-demo', name: 'Demo', query: 'has:demo' },
];

function toSmartFolder(row: typeof smartFolders.$inferSelect): SmartFolder {
  const filters = (row.filters ?? {}) as { query?: string; builtin?: boolean };
  return {
    id: row.id,
    name: row.name,
    query: filters.query ?? '',
    builtin: filters.builtin === true,
    position: row.position ?? 0,
  };
}

// List every smart folder, built-ins first, then user folders by position. The
// built-ins are returned even before they are persisted so the tree is stable on
// a fresh install.
export async function listSmartFolders(db: DatabaseState): Promise<SmartFolder[]> {
  const rows = await db.db.select().from(smartFolders).orderBy(asc(smartFolders.position));
  const user = rows.map(toSmartFolder);
  const missingBuiltins = BUILTIN_SMART_FOLDERS.filter(
    (builtin) => !user.some((folder) => folder.id === builtin.id),
  ).map((builtin, index) => ({ ...builtin, builtin: true, position: -100 + index }));
  return [...missingBuiltins, ...user].sort((a, b) => a.position - b.position);
}

// Save a search as a new smart folder (PRD-06 §8 "Save as Smart folder").
export async function createSmartFolder(
  db: DatabaseState,
  name: string,
  query: string,
): Promise<SmartFolder> {
  if (!name.trim()) throw new KilnryError('INVALID_INPUT', 'A smart folder needs a name.');
  const existing = await db.db.select().from(smartFolders);
  const id = ulid();
  const position = existing.reduce((max, row) => Math.max(max, (row.position ?? 0) + 1), 0);
  await db.db.insert(smartFolders).values({
    id,
    name: name.trim(),
    filters: { query, builtin: false },
    position,
    createdAt: new Date(),
  });
  return { id, name: name.trim(), query, builtin: false, position };
}

export async function renameSmartFolder(db: DatabaseState, id: string, name: string): Promise<void> {
  if (id.startsWith('builtin-'))
    throw new KilnryError('INVALID_INPUT', 'Built-in smart folders cannot be renamed.');
  if (!name.trim()) throw new KilnryError('INVALID_INPUT', 'A smart folder needs a name.');
  await db.db.update(smartFolders).set({ name: name.trim() }).where(eq(smartFolders.id, id));
}

// Deleting a smart folder removes no assets and no sidecars (PRD-06 §8 AC 3).
export async function deleteSmartFolder(db: DatabaseState, id: string): Promise<void> {
  if (id.startsWith('builtin-'))
    throw new KilnryError('INVALID_INPUT', 'Built-in smart folders cannot be deleted.');
  await db.db.delete(smartFolders).where(eq(smartFolders.id, id));
}

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { and, asc, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import {
  assetCharacters,
  assets,
  characterVersions,
  characterReferences,
  characters,
  trainedIdentities,
  type DatabaseState,
} from '@kilnry/db';
import type { Strategy } from '../types.js';
import { KilnryError } from '../errors.js';
import {
  loadVersion,
  lookupHandle,
  type Appearance,
  type CharacterHead,
  type CharacterKind,
} from './store.js';

// The assembled character for the detail page (TRD-04 §4).
export interface FullCharacter {
  id: string;
  handle: string;
  kind: CharacterKind;
  display_name: string;
  description?: string;
  tags: string[];
  version: number;
  versions: number[];
  is_real_person: boolean;
  consent: { status: 'self' | 'written' | 'none' | 'n/a'; evidence_asset_id?: string; granted_at?: string };
  license: string;
  appearance: Appearance;
  references: Array<{
    id: string;
    asset_id: string;
    path: string;
    preview_url: string;
    role: string;
    view?: string;
    label?: string;
    weight: number;
  }>;
  trained_identities: Array<{
    id: string;
    provider: string;
    kind: string;
    status: string;
    base_model?: string;
    trigger_word?: string;
    default_scale?: number;
    local_path?: string;
    expires_at?: string;
    cost_usd?: number;
  }>;
  voice?: { provider: string; voice_id: string };
  injection_defaults: Record<'image' | 'video' | 'audio', Strategy[]>;
  stats: { usage_count: number; last_used_at?: string; avg_consistency?: number };
  created_at: string;
  updated_at: string;
}

// The thumbnail URL for an anchor asset, served by the Library media routes.
function thumbUrl(assetId: string): string {
  return `/api/thumb/${assetId}`;
}

// A compact card for the Characters/Elements/Voices grid (F-CHR-01, F-ELM-01).
export interface CharacterCard {
  id: string;
  handle: string;
  display_name: string;
  kind: CharacterKind;
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

// Resolve a handle, honouring an @handle@vN pin, to the character id and version.
export function parseHandlePin(raw: string): { handle: string; version?: number } {
  const match = raw
    .trim()
    .replace(/^@/, '')
    .match(/^([a-z0-9_-]{2,32})(?:@v([1-9][0-9]*))?$/i);
  if (!match) throw new KilnryError('INVALID_INPUT', `"${raw}" is not a valid @handle.`);
  return match[2]
    ? { handle: match[1]!.toLowerCase(), version: Number(match[2]) }
    : { handle: match[1]!.toLowerCase() };
}

async function anchorFor(
  db: DatabaseState,
  characterId: string,
  version: number,
): Promise<string | undefined> {
  const rows = await db.db
    .select({ assetId: characterReferences.assetId })
    .from(characterReferences)
    .where(
      and(
        eq(characterReferences.characterId, characterId),
        eq(characterReferences.version, version),
        eq(characterReferences.role, 'anchor'),
      ),
    )
    .orderBy(asc(characterReferences.position))
    .limit(1);
  return rows[0]?.assetId;
}

async function trainedFor(
  db: DatabaseState,
  characterId: string,
  version: number,
): Promise<Array<{ provider: string; kind: string; status: string }>> {
  const rows = await db.db
    .select()
    .from(trainedIdentities)
    .where(and(eq(trainedIdentities.characterId, characterId), eq(trainedIdentities.version, version)));
  return rows.map((r) => ({ provider: r.providerId, kind: r.kind, status: r.status }));
}

// Build one card for the grid.
export async function cardFor(db: DatabaseState, head: CharacterHead): Promise<CharacterCard> {
  const version = await loadVersion(db, head.id, head.current_version);
  const anchor = await anchorFor(db, head.id, head.current_version);
  const trained = await trainedFor(db, head.id, head.current_version);
  const row = (await db.db.select().from(characters).where(eq(characters.id, head.id)).limit(1))[0]!;
  return {
    id: head.id,
    handle: head.handle,
    display_name: head.display_name,
    kind: head.kind,
    version: head.current_version,
    tags: row.tags ?? [],
    reference_count: version.references.length,
    trained,
    is_real_person: head.is_real_person,
    consent_status: head.consent_status,
    usage_count: row.usageCount,
    updated_at: row.updatedAt.toISOString(),
    ...(anchor ? { anchor_asset_id: anchor, anchor_preview_url: thumbUrl(anchor) } : {}),
    ...(version.voice ? { voice: version.voice } : {}),
    ...(row.lastUsedAt ? { last_used_at: row.lastUsedAt.toISOString() } : {}),
  };
}

// List cards for the grid, filtered by kind and optional tags/search (F-CHR-01).
export async function listCards(
  db: DatabaseState,
  filter: { kind?: CharacterKind; query?: string; tags?: string[] } = {},
): Promise<CharacterCard[]> {
  const clauses = [isNull(characters.deletedAt)];
  if (filter.kind) clauses.push(eq(characters.kind, filter.kind));
  if (filter.query && filter.query.trim()) {
    const q = `%${filter.query.trim().replace(/^@/, '')}%`;
    clauses.push(
      or(ilike(characters.handle, q), ilike(characters.displayName, q), ilike(characters.description, q))!,
    );
  }
  const rows = await db.db
    .select()
    .from(characters)
    .where(and(...clauses))
    .orderBy(desc(characters.lastUsedAt), desc(characters.updatedAt));
  const cards: CharacterCard[] = [];
  for (const row of rows) {
    if (filter.tags && filter.tags.length > 0) {
      const has = filter.tags.every((tag) => (row.tags ?? []).includes(tag));
      if (!has) continue;
    }
    cards.push(
      await cardFor(db, {
        id: row.id,
        handle: row.handle,
        kind: row.kind as CharacterKind,
        display_name: row.displayName,
        current_version: row.currentVersion,
        is_real_person: row.isRealPerson,
        consent_status: row.consentStatus as CharacterHead['consent_status'],
      }),
    );
  }
  return cards;
}

// Autocomplete suggestions for the @ mention popover (F-CRE-02). Matches handle,
// display name and tags by substring; returns lightweight items with a thumb.
export async function mentionSuggestions(
  db: DatabaseState,
  query: string,
  kinds: CharacterKind[] = ['character', 'prop', 'environment', 'style'],
  limit = 8,
): Promise<
  Array<{ handle: string; display_name: string; kind: CharacterKind; version: number; thumb_url?: string }>
> {
  const q = `%${query.trim().replace(/^@/, '')}%`;
  const rows = await db.db
    .select()
    .from(characters)
    .where(
      and(
        isNull(characters.deletedAt),
        sql`${characters.kind} = any(${sql.raw(`array[${kinds.map((k) => `'${k}'`).join(',')}]`)})`,
        or(ilike(characters.handle, q), ilike(characters.displayName, q))!,
      ),
    )
    .orderBy(desc(characters.lastUsedAt), asc(characters.handle))
    .limit(limit);
  const items: Array<{
    handle: string;
    display_name: string;
    kind: CharacterKind;
    version: number;
    thumb_url?: string;
  }> = [];
  for (const row of rows) {
    const anchor = await anchorFor(db, row.id, row.currentVersion);
    items.push({
      handle: row.handle,
      display_name: row.displayName,
      kind: row.kind as CharacterKind,
      version: row.currentVersion,
      ...(anchor ? { thumb_url: thumbUrl(anchor) } : {}),
    });
  }
  return items;
}

// Assemble the full character for the detail page (FullCharacter, TRD-04 §4).
export async function loadFullCharacter(
  db: DatabaseState,
  handle: string,
  version?: number,
): Promise<FullCharacter> {
  const head = await lookupHandle(db, handle);
  if (!head) throw new KilnryError('NOT_FOUND', `@${handle.replace(/^@/, '')} is not a Character.`);
  const wanted = version ?? head.current_version;
  const loaded = await loadVersion(db, head.id, wanted);
  const row = (await db.db.select().from(characters).where(eq(characters.id, head.id)).limit(1))[0]!;
  const versionRows = await db.db
    .select({ version: characterVersions.version })
    .from(characterVersions)
    .where(eq(characterVersions.characterId, head.id))
    .orderBy(asc(characterVersions.version));
  const trained = await db.db
    .select()
    .from(trainedIdentities)
    .where(and(eq(trainedIdentities.characterId, head.id), eq(trainedIdentities.version, wanted)));
  const references = await Promise.all(
    loaded.references.map(async (ref) => {
      const asset = (
        await db.db.select({ path: assets.path }).from(assets).where(eq(assets.id, ref.asset_id)).limit(1)
      )[0];
      return {
        id: ref.id,
        asset_id: ref.asset_id,
        path: asset?.path ?? '',
        preview_url: thumbUrl(ref.asset_id),
        role: ref.role,
        weight: ref.weight,
        ...(ref.view ? { view: ref.view } : {}),
        ...(ref.label ? { label: ref.label } : {}),
      };
    }),
  );
  const defaults = (loaded.injection_defaults ?? {}) as Record<'image' | 'video' | 'audio', Strategy[]>;
  return {
    id: head.id,
    handle: head.handle,
    kind: head.kind,
    display_name: head.display_name,
    tags: row.tags ?? [],
    version: wanted,
    versions: versionRows.map((v) => v.version),
    is_real_person: head.is_real_person,
    consent: {
      status: head.consent_status,
      ...(row.consentEvidenceAssetId ? { evidence_asset_id: row.consentEvidenceAssetId } : {}),
      ...(row.consentGrantedAt ? { granted_at: row.consentGrantedAt.toISOString() } : {}),
    },
    license: row.license,
    appearance: loaded.appearance,
    references,
    trained_identities: trained.map((t) => ({
      id: t.id,
      provider: t.providerId,
      kind: t.kind,
      status: t.status,
      ...(t.baseModel ? { base_model: t.baseModel } : {}),
      ...(t.triggerWord ? { trigger_word: t.triggerWord } : {}),
      ...(t.defaultScale ? { default_scale: Number(t.defaultScale) } : {}),
      ...(t.localPath ? { local_path: t.localPath } : {}),
      ...(t.expiresAt ? { expires_at: t.expiresAt.toISOString() } : {}),
      ...(t.costUsd ? { cost_usd: Number(t.costUsd) } : {}),
    })),
    ...(loaded.voice ? { voice: loaded.voice } : {}),
    injection_defaults: {
      image: defaults.image ?? [],
      video: defaults.video ?? [],
      audio: defaults.audio ?? [],
    },
    stats: {
      usage_count: row.usageCount,
      ...(row.lastUsedAt ? { last_used_at: row.lastUsedAt.toISOString() } : {}),
    },
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    ...(row.description ? { description: row.description } : {}),
  };
}

// Assets made with a Character, newest first, for the Usage tab (F-CHR-11) and the
// Library "by character" filter (F-LIB-06). Reads the asset_characters lineage.
export interface UsageAsset {
  asset_id: string;
  path: string;
  kind: string;
  preview_url: string;
  created_at: string;
}

export async function usageAssets(db: DatabaseState, handle: string, limit = 60): Promise<UsageAsset[]> {
  const head = await lookupHandle(db, handle);
  if (!head) throw new KilnryError('NOT_FOUND', `@${handle.replace(/^@/, '')} is not a Character.`);
  const rows = await db.db
    .select({
      assetId: assets.id,
      path: assets.path,
      kind: assets.kind,
      createdAt: assets.createdAt,
    })
    .from(assetCharacters)
    .innerJoin(assets, eq(assets.id, assetCharacters.assetId))
    .where(and(eq(assetCharacters.characterId, head.id), isNull(assets.trashedAt)))
    .orderBy(desc(assets.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    asset_id: r.assetId,
    path: r.path,
    kind: r.kind,
    preview_url: thumbUrl(r.assetId),
    created_at: r.createdAt.toISOString(),
  }));
}

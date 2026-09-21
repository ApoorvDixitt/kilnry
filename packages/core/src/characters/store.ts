// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  assetCharacters,
  characterHandleAliases,
  characterReferences,
  characterVersions,
  characterVoices,
  characters,
  voices,
  type DatabaseState,
} from '@kilnry/db';
import { KilnryError } from '../errors.js';
import { ulid } from '../ids.js';
import type { Strategy } from '../types.js';

export type CharacterKind = 'character' | 'prop' | 'environment' | 'style';

export interface Appearance {
  descriptor: string;
  anchors: string[];
  negative_traits: string[];
  palette_hex?: string[];
  gendered_noun?: 'woman' | 'man' | 'person' | 'figure';
  // A product Element fetched from a URL carries its facts here (F-ELM-04). Only
  // the approved (ticked) claims are ever exposed to a workflow.
  product_facts?: {
    title?: string;
    description?: string;
    brand?: string;
    price?: string;
    claims: string[];
    approved_claims: string[];
    source_url?: string;
    fetched_at?: string;
  };
}

export interface CharacterHead {
  id: string;
  handle: string;
  kind: CharacterKind;
  display_name: string;
  current_version: number;
  is_real_person: boolean;
  consent_status: 'self' | 'written' | 'none' | 'n/a';
}

export interface ReferenceRow {
  id: string;
  asset_id: string;
  role: string;
  view?: string;
  label?: string;
  weight: number;
  position: number | null;
}

export interface LoadedVersion {
  id: string;
  handle: string;
  kind: CharacterKind;
  display_name: string;
  version: number;
  is_real_person: boolean;
  consent_status: 'self' | 'written' | 'none' | 'n/a';
  appearance: Appearance;
  injection_defaults?: Partial<Record<'image' | 'video' | 'audio', Strategy[]>>;
  references: ReferenceRow[];
  frozen: boolean;
  voice?: { provider: string; voice_id: string };
}

// The `[a-z0-9_-]{2,32}` handle grammar of TRD-14 §1, case-insensitive on input.
const HANDLE_RE = /^[a-z0-9_-]{2,32}$/;

export function normaliseHandle(input: string): string {
  const handle = input.trim().toLowerCase().replace(/^@/, '');
  if (!HANDLE_RE.test(handle)) {
    throw new KilnryError('INVALID_INPUT', `"${input}" is not a valid @handle (2–32 of a–z, 0–9, _ or -).`);
  }
  return handle;
}

export function isValidHandle(input: string): boolean {
  return HANDLE_RE.test(input.trim().toLowerCase().replace(/^@/, ''));
}

interface CreateCharacterInput {
  handle: string;
  kind: CharacterKind;
  display_name: string;
  description?: string;
  tags?: string[];
  appearance?: Appearance;
  injection_defaults?: Partial<Record<'image' | 'video' | 'audio', Strategy[]>>;
  cast_params?: Record<string, unknown>;
  is_real_person?: boolean;
}

// Create a Character (or Element) with its first version. Handles are unique and
// aliases are consulted so a taken handle is reported clearly.
export async function createCharacter(
  state: DatabaseState,
  input: CreateCharacterInput,
): Promise<CharacterHead> {
  const handle = normaliseHandle(input.handle);
  const existing = await lookupHandle(state, handle);
  if (existing) throw new KilnryError('INVALID_INPUT', `The handle @${handle} is already in use.`);
  const id = ulid();
  const now = new Date();
  await state.db.transaction(async (tx) => {
    await tx.insert(characters).values({
      id,
      handle,
      kind: input.kind,
      displayName: input.display_name,
      description: input.description ?? null,
      tags: input.tags ?? [],
      isRealPerson: input.is_real_person ?? false,
      consentStatus: input.is_real_person ? 'none' : 'n/a',
      currentVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(characterVersions).values({
      characterId: id,
      version: 1,
      appearance: (input.appearance ?? {
        descriptor: '',
        anchors: [],
        negative_traits: [],
      }) as unknown as Record<string, unknown>,
      injectionDefaults: (input.injection_defaults ?? null) as unknown as Record<string, unknown> | null,
      castParams: (input.cast_params ?? null) as Record<string, unknown> | null,
      frozen: false,
      createdAt: now,
    });
  });
  return {
    id,
    handle,
    kind: input.kind,
    display_name: input.display_name,
    current_version: 1,
    is_real_person: input.is_real_person ?? false,
    consent_status: input.is_real_person ? 'none' : 'n/a',
  };
}

// Resolve a handle to a Character head, following one alias hop (TRD-14 §1, §13).
export async function lookupHandle(
  state: DatabaseState,
  rawHandle: string,
): Promise<CharacterHead | undefined> {
  const handle = rawHandle.trim().toLowerCase().replace(/^@/, '');
  const direct = await state.db
    .select()
    .from(characters)
    .where(and(eq(characters.handle, handle), isNull(characters.deletedAt)))
    .limit(1);
  if (direct[0]) return toHead(direct[0]);
  const alias = await state.db
    .select({ characterId: characterHandleAliases.characterId })
    .from(characterHandleAliases)
    .where(eq(characterHandleAliases.alias, handle))
    .limit(1);
  if (!alias[0]) return undefined;
  const target = await state.db
    .select()
    .from(characters)
    .where(and(eq(characters.id, alias[0].characterId), isNull(characters.deletedAt)))
    .limit(1);
  return target[0] ? toHead(target[0]) : undefined;
}

// Load a full version with its ordered references, appearance, injection defaults
// and bound voice. Used by the resolver's `loadVersion` and the detail route.
export async function loadVersion(
  state: DatabaseState,
  characterId: string,
  version?: number,
): Promise<LoadedVersion> {
  const head = await state.db.select().from(characters).where(eq(characters.id, characterId)).limit(1);
  if (!head[0]) throw new KilnryError('NOT_FOUND', 'Character not found.');
  const wanted = version ?? head[0].currentVersion;
  const rows = await state.db
    .select()
    .from(characterVersions)
    .where(and(eq(characterVersions.characterId, characterId), eq(characterVersions.version, wanted)))
    .limit(1);
  if (!rows[0]) throw new KilnryError('NOT_FOUND', `Version ${wanted} of @${head[0].handle} does not exist.`);
  const refs = await state.db
    .select()
    .from(characterReferences)
    .where(and(eq(characterReferences.characterId, characterId), eq(characterReferences.version, wanted)))
    .orderBy(characterReferences.position);
  const voice = await loadBoundVoice(state, characterId, wanted);
  const raw = (rows[0].appearance ?? {}) as Partial<Appearance>;
  const appearance: Appearance = {
    descriptor: raw.descriptor ?? '',
    anchors: raw.anchors ?? [],
    negative_traits: raw.negative_traits ?? [],
    ...(raw.palette_hex ? { palette_hex: raw.palette_hex } : {}),
    ...(raw.gendered_noun ? { gendered_noun: raw.gendered_noun } : {}),
  };
  const result: LoadedVersion = {
    id: characterId,
    handle: head[0].handle,
    kind: head[0].kind as CharacterKind,
    display_name: head[0].displayName,
    version: wanted,
    is_real_person: head[0].isRealPerson,
    consent_status: head[0].consentStatus as LoadedVersion['consent_status'],
    appearance,
    references: refs.map((r) => ({
      id: r.id,
      asset_id: r.assetId,
      role: r.role,
      weight: Number(r.weight),
      position: r.position,
      ...(r.view ? { view: r.view } : {}),
      ...(r.label ? { label: r.label } : {}),
    })),
    frozen: rows[0].frozen,
    ...(rows[0].injectionDefaults
      ? {
          injection_defaults: rows[0].injectionDefaults as NonNullable<LoadedVersion['injection_defaults']>,
        }
      : {}),
    ...(voice ? { voice } : {}),
  };
  return result;
}

async function loadBoundVoice(
  state: DatabaseState,
  characterId: string,
  version: number,
): Promise<{ provider: string; voice_id: string } | undefined> {
  const bound = await state.db
    .select({ voiceUlid: characterVoices.voiceUlid })
    .from(characterVoices)
    .where(and(eq(characterVoices.characterId, characterId), eq(characterVoices.version, version)))
    .limit(1);
  if (!bound[0]) return undefined;
  const voice = await state.db.select().from(voices).where(eq(voices.id, bound[0].voiceUlid)).limit(1);
  if (!voice[0]) return undefined;
  return { provider: voice[0].providerId, voice_id: voice[0].voiceId };
}

interface AddReferenceInput {
  asset_id: string;
  role: string;
  view?: string | undefined;
  label?: string | undefined;
  weight?: number | undefined;
}

// Add references to a Character's current version, or fork a new unfrozen version
// first when the current one has been used by a job (TRD-04 invariant 4).
export async function addReferences(
  state: DatabaseState,
  characterId: string,
  refs: AddReferenceInput[],
): Promise<number> {
  const version = await ensureUnfrozenVersion(state, characterId);
  const existing = await state.db
    .select({ position: characterReferences.position })
    .from(characterReferences)
    .where(and(eq(characterReferences.characterId, characterId), eq(characterReferences.version, version)));
  let next = existing.reduce((max, r) => Math.max(max, (r.position ?? 0) + 1), 0);
  for (const ref of refs) {
    await state.db.insert(characterReferences).values({
      id: ulid(),
      characterId,
      version,
      assetId: ref.asset_id,
      role: ref.role,
      view: ref.view ?? null,
      label: ref.label ?? null,
      weight: String(ref.weight ?? 1),
      position: next,
    });
    next += 1;
  }
  await touchCharacter(state, characterId);
  return version;
}

export async function removeReference(
  state: DatabaseState,
  characterId: string,
  referenceId: string,
): Promise<number> {
  const version = await ensureUnfrozenVersion(state, characterId);
  await state.db
    .delete(characterReferences)
    .where(
      and(
        eq(characterReferences.id, referenceId),
        eq(characterReferences.characterId, characterId),
        eq(characterReferences.version, version),
      ),
    );
  await touchCharacter(state, characterId);
  return version;
}

// Return the current version if unfrozen; otherwise fork current_version + 1 with
// the references, appearance and injection defaults copied forward.
export async function ensureUnfrozenVersion(state: DatabaseState, characterId: string): Promise<number> {
  const head = await state.db.select().from(characters).where(eq(characters.id, characterId)).limit(1);
  if (!head[0]) throw new KilnryError('NOT_FOUND', 'Character not found.');
  const current = head[0].currentVersion;
  const version = await state.db
    .select()
    .from(characterVersions)
    .where(and(eq(characterVersions.characterId, characterId), eq(characterVersions.version, current)))
    .limit(1);
  if (version[0] && !version[0].frozen) return current;
  return forkVersion(state, characterId);
}

// Fork the current version to current_version + 1, carrying references and the
// appearance forward but not trained identities or voices (TRD-14 §13).
export async function forkVersion(state: DatabaseState, characterId: string): Promise<number> {
  return state.db.transaction(async (tx) => {
    const head = await tx.select().from(characters).where(eq(characters.id, characterId)).limit(1);
    if (!head[0]) throw new KilnryError('NOT_FOUND', 'Character not found.');
    const from = head[0].currentVersion;
    const next = from + 1;
    const source = await tx
      .select()
      .from(characterVersions)
      .where(and(eq(characterVersions.characterId, characterId), eq(characterVersions.version, from)))
      .limit(1);
    await tx.insert(characterVersions).values({
      characterId,
      version: next,
      parentVersion: from,
      appearance: source[0]?.appearance ?? null,
      injectionDefaults: source[0]?.injectionDefaults ?? null,
      castParams: source[0]?.castParams ?? null,
      frozen: false,
      createdAt: new Date(),
    });
    const refs = await tx
      .select()
      .from(characterReferences)
      .where(and(eq(characterReferences.characterId, characterId), eq(characterReferences.version, from)));
    for (const ref of refs) {
      await tx.insert(characterReferences).values({
        id: ulid(),
        characterId,
        version: next,
        assetId: ref.assetId,
        role: ref.role,
        view: ref.view,
        label: ref.label,
        weight: ref.weight,
        position: ref.position,
      });
    }
    await tx
      .update(characters)
      .set({ currentVersion: next, updatedAt: new Date() })
      .where(eq(characters.id, characterId));
    return next;
  });
}

// Mark a version frozen the moment a job references it (TRD-14 §6, invariant 4).
export async function freezeVersion(
  state: DatabaseState,
  characterId: string,
  version: number,
): Promise<void> {
  await state.db
    .update(characterVersions)
    .set({ frozen: true })
    .where(and(eq(characterVersions.characterId, characterId), eq(characterVersions.version, version)));
}

// Edit a version's appearance descriptor, anchors and negatives. When the current
// version is frozen (a job has used it) the edit forks a new unfrozen version and
// writes to that, so no running or finished job's look can change (PRD-07 §11
// rule 3, TRD-14 §13). Returns the version the edit landed on.
export async function setAppearance(
  state: DatabaseState,
  characterId: string,
  appearance: Partial<Appearance>,
): Promise<number> {
  const version = await ensureUnfrozenVersion(state, characterId);
  const current = await state.db
    .select({ appearance: characterVersions.appearance })
    .from(characterVersions)
    .where(and(eq(characterVersions.characterId, characterId), eq(characterVersions.version, version)))
    .limit(1);
  const prior = (current[0]?.appearance ?? {}) as Partial<Appearance>;
  const merged: Partial<Appearance> = {
    ...prior,
    ...(appearance.descriptor !== undefined ? { descriptor: appearance.descriptor } : {}),
    ...(appearance.anchors !== undefined ? { anchors: appearance.anchors } : {}),
    ...(appearance.negative_traits !== undefined ? { negative_traits: appearance.negative_traits } : {}),
    ...(appearance.palette_hex !== undefined ? { palette_hex: appearance.palette_hex } : {}),
    ...(appearance.gendered_noun !== undefined ? { gendered_noun: appearance.gendered_noun } : {}),
  };
  await state.db
    .update(characterVersions)
    .set({ appearance: merged as unknown as Record<string, unknown> })
    .where(and(eq(characterVersions.characterId, characterId), eq(characterVersions.version, version)));
  await touchCharacter(state, characterId);
  return version;
}

// Point current_version at any existing version (the switcher's "Set as current",
// PRD-07 §11). Later versions are left in place and stay resolvable by pin.
export async function setCurrentVersion(
  state: DatabaseState,
  characterId: string,
  version: number,
): Promise<void> {
  const exists = await state.db
    .select({ version: characterVersions.version })
    .from(characterVersions)
    .where(and(eq(characterVersions.characterId, characterId), eq(characterVersions.version, version)))
    .limit(1);
  if (!exists[0]) throw new KilnryError('NOT_FOUND', `Version ${version} does not exist.`);
  await state.db
    .update(characters)
    .set({ currentVersion: version, updatedAt: new Date() })
    .where(eq(characters.id, characterId));
}

// One row per version for the header switcher and kilnry_characters.get.versions:
// the version number, whether it is frozen, whether it is current, and how many
// jobs have referenced it (PRD-07 §11 acceptance 3).
export interface VersionRow {
  version: number;
  frozen: boolean;
  current: boolean;
  jobs: number;
}

export async function listVersions(state: DatabaseState, characterId: string): Promise<VersionRow[]> {
  const head = await state.db
    .select({ currentVersion: characters.currentVersion })
    .from(characters)
    .where(eq(characters.id, characterId))
    .limit(1);
  if (!head[0]) throw new KilnryError('NOT_FOUND', 'Character not found.');
  const rows = await state.db
    .select({ version: characterVersions.version, frozen: characterVersions.frozen })
    .from(characterVersions)
    .where(eq(characterVersions.characterId, characterId))
    .orderBy(desc(characterVersions.version));
  const counts = await state.db
    .select({ version: assetCharacters.version, count: sql<number>`count(*)::int` })
    .from(assetCharacters)
    .where(eq(assetCharacters.characterId, characterId))
    .groupBy(assetCharacters.version);
  const jobsByVersion = new Map<number, number>();
  for (const row of counts) jobsByVersion.set(row.version, Number(row.count));
  return rows.map((row) => ({
    version: row.version,
    frozen: row.frozen,
    current: row.version === head[0]!.currentVersion,
    jobs: jobsByVersion.get(row.version) ?? 0,
  }));
}

// Record the lineage of a finished asset: one asset_characters row per injected
// character, the usage counter bumped, and the used version frozen (TRD-14 §6).
export async function recordAssetCharacters(
  state: DatabaseState,
  assetId: string,
  injections: Array<{ character_id: string; version: number; strategy: string }>,
): Promise<void> {
  const seen = new Set<string>();
  for (const injection of injections) {
    if (seen.has(injection.character_id)) continue;
    seen.add(injection.character_id);
    await state.db
      .insert(assetCharacters)
      .values({
        assetId,
        characterId: injection.character_id,
        version: injection.version,
        strategy: injection.strategy,
      })
      .onConflictDoNothing();
    await state.db
      .update(characters)
      .set({ usageCount: sql`${characters.usageCount} + 1`, lastUsedAt: new Date() })
      .where(eq(characters.id, injection.character_id));
    await freezeVersion(state, injection.character_id, injection.version);
  }
}

// Assets made with a Character, newest first (Usage tab, F-CHR-11).
export async function assetsForCharacter(state: DatabaseState, characterId: string): Promise<string[]> {
  const rows = await state.db
    .select({ assetId: assetCharacters.assetId })
    .from(assetCharacters)
    .where(eq(assetCharacters.characterId, characterId))
    .orderBy(desc(assetCharacters.assetId));
  return rows.map((r) => r.assetId);
}

export async function listCharacters(
  state: DatabaseState,
  filter: { kind?: CharacterKind } = {},
): Promise<CharacterHead[]> {
  const where = filter.kind
    ? and(isNull(characters.deletedAt), eq(characters.kind, filter.kind))
    : isNull(characters.deletedAt);
  const rows = await state.db.select().from(characters).where(where).orderBy(desc(characters.updatedAt));
  return rows.map(toHead);
}

// Rename by writing an alias row; the handle itself is immutable after first use.
export async function addHandleAlias(
  state: DatabaseState,
  oldHandle: string,
  characterId: string,
): Promise<void> {
  await state.db
    .insert(characterHandleAliases)
    .values({ alias: normaliseHandle(oldHandle), characterId, createdAt: new Date() })
    .onConflictDoNothing();
}

async function touchCharacter(state: DatabaseState, characterId: string): Promise<void> {
  await state.db.update(characters).set({ updatedAt: new Date() }).where(eq(characters.id, characterId));
}

function toHead(row: typeof characters.$inferSelect): CharacterHead {
  return {
    id: row.id,
    handle: row.handle,
    kind: row.kind as CharacterKind,
    display_name: row.displayName,
    current_version: row.currentVersion,
    is_real_person: row.isRealPerson,
    consent_status: row.consentStatus as CharacterHead['consent_status'],
  };
}

// Batch head lookup used by the resolver when explicit `characters[]` handles are
// supplied alongside @mentions.
export async function headsByIds(state: DatabaseState, ids: string[]): Promise<Map<string, CharacterHead>> {
  if (ids.length === 0) return new Map();
  const rows = await state.db.select().from(characters).where(inArray(characters.id, ids));
  return new Map(rows.map((row) => [row.id, toHead(row)]));
}

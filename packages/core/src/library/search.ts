// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  not,
  or,
  type SQL,
} from 'drizzle-orm';
import { assets, assetCharacters, characters, characterHandleAliases, type DatabaseState } from '@kilnry/db';
import { KilnryError } from '../errors.js';
import type { AssetListItem, AssetSort } from './assets.js';

// The structured shape of a Library search query, parsed from the one-line
// syntax in PRD-06. Every field is optional; free words match text columns.
export interface ParsedQuery {
  text: string[];
  phrases: string[];
  handles: string[];
  types: string[];
  models: string[];
  providers: string[];
  sources: string[];
  tags: string[];
  labels: string[];
  folders: string[];
  has: string[];
  in: string[];
  costGt?: number;
  costLt?: number;
  ratingGt?: number;
  durGt?: number;
  durLt?: number;
  since?: string; // ISO timestamp lower bound
  until?: string; // ISO timestamp upper bound
  negText: string[];
  negTypes: string[];
  negModels: string[];
  sort: AssetSort;
}

function emptyQuery(): ParsedQuery {
  return {
    text: [],
    phrases: [],
    handles: [],
    types: [],
    models: [],
    providers: [],
    sources: [],
    tags: [],
    labels: [],
    folders: [],
    has: [],
    in: [],
    negText: [],
    negTypes: [],
    negModels: [],
    sort: 'newest',
  };
}

// Turn a relative age such as "7d", "24h" or an absolute "2026-09-01" into an
// ISO timestamp. Throws on anything that is not a recognised form.
export function resolveSince(token: string, now: Date = new Date()): string {
  const relative = /^(\d+)([dhw])$/.exec(token);
  if (relative) {
    const amount = Number(relative[1]);
    const unitMs = relative[2] === 'h' ? 3_600_000 : relative[2] === 'w' ? 604_800_000 : 86_400_000;
    return new Date(now.getTime() - amount * unitMs).toISOString();
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) {
    const date = new Date(`${token}T00:00:00.000Z`);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  throw new KilnryError('INVALID_INPUT', `"${token}" isn't a date. Try 7d, 24h or 2026-09-01.`);
}

function numberOrThrow(raw: string, token: string): number {
  const value = Number(raw);
  if (Number.isNaN(value)) throw new KilnryError('INVALID_INPUT', `"${token}" isn't a number.`);
  return value;
}

// Split a query into tokens, keeping quoted phrases together.
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  const pattern = /-?"[^"]*"|\S+/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input)) !== null) tokens.push(match[0]);
  return tokens;
}

const SORTS = new Set<AssetSort>(['newest', 'oldest', 'name', 'cost', 'duration']);

export function parseSearchQuery(input: string, now: Date = new Date()): ParsedQuery {
  const query = emptyQuery();
  for (const token of tokenize(input.trim())) {
    const negated = token.startsWith('-');
    const body = negated ? token.slice(1) : token;

    if (body.startsWith('"') && body.endsWith('"')) {
      query.phrases.push(body.slice(1, -1));
      continue;
    }
    if (body.startsWith('@')) {
      query.handles.push(body.slice(1).toLowerCase());
      continue;
    }

    const colon = body.indexOf(':');
    const gt = /^(cost|dur|rating)>(.+)$/.exec(body);
    const lt = /^(cost|dur)<(.+)$/.exec(body);

    if (gt) {
      const value = numberOrThrow(gt[2]!, body);
      if (gt[1] === 'cost') query.costGt = value;
      else if (gt[1] === 'dur') query.durGt = value;
      else query.ratingGt = value;
      continue;
    }
    if (lt) {
      const value = numberOrThrow(lt[2]!, body);
      if (lt[1] === 'cost') query.costLt = value;
      else query.durLt = value;
      continue;
    }

    if (colon > 0) {
      const key = body.slice(0, colon);
      const value = body.slice(colon + 1).toLowerCase();
      switch (key) {
        case 'type':
          (negated ? query.negTypes : query.types).push(value);
          break;
        case 'model':
          (negated ? query.negModels : query.models).push(value);
          break;
        case 'provider':
          query.providers.push(value);
          break;
        case 'source':
          query.sources.push(value);
          break;
        case 'tag':
          query.tags.push(value);
          break;
        case 'label':
          query.labels.push(value);
          break;
        case 'folder':
          query.folders.push(value);
          break;
        case 'character':
          query.handles.push(value.replace(/^@/, ''));
          break;
        case 'has':
          query.has.push(value);
          break;
        case 'in':
          query.in.push(value);
          break;
        case 'since':
          query.since = resolveSince(value, now);
          break;
        case 'until':
          query.until = resolveSince(value, now);
          break;
        case 'sort':
          if (SORTS.has(value as AssetSort)) query.sort = value as AssetSort;
          break;
        default:
          (negated ? query.negText : query.text).push(body);
      }
      continue;
    }

    (negated ? query.negText : query.text).push(body.toLowerCase());
  }
  return query;
}

// Build the where-conditions and sort for a parsed query and run it against the
// index, returning the same shape the grid uses. Text matches are substring
// (ILIKE) over prompt, filename, notes and resolved prompt.
export async function searchAssets(state: DatabaseState, parsed: ParsedQuery): Promise<AssetListItem[]> {
  const conditions: SQL[] = [];

  const inTrash = parsed.in.includes('trash');
  conditions.push(inTrash ? isNotNull(assets.trashedAt) : isNull(assets.trashedAt));
  if (parsed.in.includes('inbox')) conditions.push(eq(assets.folderPath, 'inbox'));

  for (const word of [...parsed.text, ...parsed.phrases]) {
    const needle = `%${word}%`;
    const clause = or(
      ilike(assets.prompt, needle),
      ilike(assets.resolvedPrompt, needle),
      ilike(assets.path, needle),
      ilike(assets.userNotes, needle),
    );
    if (clause) conditions.push(clause);
  }
  for (const word of parsed.negText) {
    const needle = `%${word}%`;
    const clause = or(ilike(assets.prompt, needle), ilike(assets.path, needle));
    if (clause) conditions.push(not(clause));
  }

  if (parsed.types.length > 0) conditions.push(inArray(assets.kind, parsed.types));
  if (parsed.negTypes.length > 0) conditions.push(not(inArray(assets.kind, parsed.negTypes)));
  if (parsed.providers.length > 0) conditions.push(inArray(assets.providerId, parsed.providers));
  if (parsed.sources.length > 0) conditions.push(inArray(assets.source, parsed.sources));
  if (parsed.labels.length > 0) conditions.push(inArray(assets.label, parsed.labels));
  for (const model of parsed.models) conditions.push(ilike(assets.modelId, `%${model}%`));
  for (const model of parsed.negModels) conditions.push(not(ilike(assets.modelId, `%${model}%`)));
  for (const folder of parsed.folders) {
    const clause = or(eq(assets.folderPath, folder), ilike(assets.folderPath, `${folder}/%`));
    if (clause) conditions.push(clause);
  }

  // Filter by character (F-CHR-11, F-LIB-06): resolve each @handle to its id,
  // following one rename alias, then keep only assets with a lineage row for it.
  if (parsed.handles.length > 0) {
    const ids = new Set<string>();
    for (const handle of parsed.handles) {
      const direct = await state.db
        .select({ id: characters.id })
        .from(characters)
        .where(eq(characters.handle, handle))
        .limit(1);
      if (direct[0]) {
        ids.add(direct[0].id);
        continue;
      }
      const alias = await state.db
        .select({ id: characterHandleAliases.characterId })
        .from(characterHandleAliases)
        .where(eq(characterHandleAliases.alias, handle))
        .limit(1);
      if (alias[0]) ids.add(alias[0].id);
    }
    const matching = await state.db
      .select({ assetId: assetCharacters.assetId })
      .from(assetCharacters)
      .where(
        ids.size > 0 ? inArray(assetCharacters.characterId, [...ids]) : eq(assetCharacters.characterId, '∅'),
      );
    const assetIds = matching.map((row) => row.assetId);
    conditions.push(assetIds.length > 0 ? inArray(assets.id, assetIds) : eq(assets.id, '∅'));
  }

  if (parsed.costGt !== undefined) conditions.push(gt(assets.actualUsd, String(parsed.costGt)));
  if (parsed.costLt !== undefined) conditions.push(lt(assets.actualUsd, String(parsed.costLt)));
  if (parsed.ratingGt !== undefined) conditions.push(gt(assets.rating, parsed.ratingGt));
  if (parsed.durGt !== undefined) conditions.push(gt(assets.durationS, String(parsed.durGt)));
  if (parsed.durLt !== undefined) conditions.push(lt(assets.durationS, String(parsed.durLt)));
  if (parsed.since) conditions.push(gte(assets.createdAt, new Date(parsed.since)));
  if (parsed.until) conditions.push(lte(assets.createdAt, new Date(parsed.until)));

  for (const flag of parsed.has) {
    if (flag === 'nosidecar') conditions.push(eq(assets.sidecarOk, false));
    else if (flag === 'sidecar') conditions.push(eq(assets.sidecarOk, true));
    else if (flag === 'audio') conditions.push(eq(assets.hasAudio, true));
  }

  const order =
    parsed.sort === 'oldest'
      ? [asc(assets.createdAt)]
      : parsed.sort === 'name'
        ? [asc(assets.path)]
        : parsed.sort === 'cost'
          ? [desc(assets.actualUsd)]
          : parsed.sort === 'duration'
            ? [desc(assets.durationS)]
            : [desc(assets.createdAt)];

  const rows = await state.db
    .select()
    .from(assets)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(...order)
    .limit(2000);

  return rows.map((row) => ({
    id: row.id,
    path: row.path,
    folder_path: row.folderPath,
    kind: row.kind,
    mime: row.mime,
    width: row.width,
    height: row.height,
    duration_s: row.durationS === null ? null : Number(row.durationS),
    has_audio: row.hasAudio,
    provider_id: row.providerId,
    actual_usd: row.actualUsd === null ? null : Number(row.actualUsd),
    estimate_usd: row.estimateUsd === null ? null : Number(row.estimateUsd),
    sidecar_ok: row.sidecarOk,
    created_at: row.createdAt.toISOString(),
  }));
}

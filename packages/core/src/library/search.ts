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
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  assets,
  assetCharacters,
  assetLineage,
  assetTags,
  characters,
  characterHandleAliases,
  type DatabaseState,
} from '@kilnry/db';
import { KilnryError } from '../errors.js';
import type { AssetListItem, AssetSort } from './assets.js';

// The structured shape of a Library search query, parsed from the one-line
// syntax in PRD-06. Every field is optional; free words match text columns.
export interface ParsedQuery {
  text: string[];
  phrases: string[];
  handles: Array<{ handle: string; version?: number }>;
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
  costEq?: number;
  /** `ar:9:16` as a number, with the text the user typed for the message. */
  aspect?: { ratio: number; label: string };
  /** `res:4k` and friends: the minimum height of the tier. */
  resolution?: { minHeight: number; label: string };
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

/**
 * The resolution tiers `res:` accepts, by the shortest side the tier needs.
 * PRD-06:227 names the operator and gives `res:4k` as the example without
 * fixing the vocabulary, so these are the common tiers (default; adjustable).
 */
const RESOLUTION_TIERS: Record<string, number> = {
  sd: 0,
  '720p': 720,
  hd: 720,
  '1080p': 1080,
  fhd: 1080,
  '2k': 1440,
  '4k': 2160,
  '8k': 4320,
};

/** `@maya@v2` → the handle and the pinned version (PRD-06:217). */
function parseHandleToken(raw: string): { handle: string; version?: number } {
  const match = /^(.*)@v(\d+)$/.exec(raw.toLowerCase());
  if (!match) return { handle: raw.toLowerCase() };
  return { handle: match[1]!, version: Number(match[2]) };
}

/** `9:16`, `16x9` or `1.777` as a number. */
function parseAspect(value: string): number | undefined {
  const pair = /^(\d+(?:\.\d+)?)[:x/](\d+(?:\.\d+)?)$/.exec(value);
  if (pair) {
    const height = Number(pair[2]);
    if (height === 0) return undefined;
    return Number(pair[1]) / height;
  }
  const single = Number(value);
  return Number.isFinite(single) && single > 0 ? single : undefined;
}

/**
 * ILIKE treats % and _ as wildcards, so a user who typed "100%" got every row
 * containing "100" (https://www.postgresql.org/docs/current/functions-matching.html,
 * read 2026-10-07). The search is specified as literal substring matching, so
 * the needle escapes them (F-72).
 */
export function likeNeedle(word: string): string {
  return `%${word.replace(/([\\%_])/g, '\\$1')}%`;
}

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
      // `@maya@v2` pins the version (PRD-06:217, :245 acceptance 3). The whole
      // string after the first @ became the handle, so the lookup searched for
      // "maya@v2", found nothing and returned zero results (F-37).
      query.handles.push(parseHandleToken(body.slice(1)));
      continue;
    }

    const colon = body.indexOf(':');
    const gt = /^(cost|dur|rating)>(.+)$/.exec(body);
    const lt = /^(cost|dur)<(.+)$/.exec(body);
    // `cost=` is in the table beside cost> and cost< and had no branch, so an
    // exact-cost search became a substring search and matched nothing (F-36).
    const eqCost = /^cost=(.+)$/.exec(body);

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
    if (eqCost) {
      query.costEq = numberOrThrow(eqCost[1]!, body);
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
          query.handles.push(parseHandleToken(value.replace(/^@/, '')));
          break;
        // `ar:` and `res:` were in the table and in no switch, so they fell
        // through to free text and matched the literal string (F-35).
        case 'ar': {
          const ratio = parseAspect(value);
          if (ratio === undefined) throw new KilnryError('INVALID_INPUT', `"${body}" isn't an aspect ratio.`);
          query.aspect = { ratio, label: value };
          break;
        }
        case 'res': {
          const tier = RESOLUTION_TIERS[value];
          if (tier === undefined) {
            throw new KilnryError(
              'INVALID_INPUT',
              `"${body}" isn't a resolution tier. Try ${Object.keys(RESOLUTION_TIERS).join(', ')}.`,
            );
          }
          query.resolution = { minHeight: tier, label: value };
          break;
        }
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
    const needle = likeNeedle(word);
    const clause = or(
      ilike(assets.prompt, needle),
      ilike(assets.resolvedPrompt, needle),
      ilike(assets.path, needle),
      ilike(assets.userNotes, needle),
    );
    if (clause) conditions.push(clause);
  }
  for (const word of parsed.negText) {
    const needle = likeNeedle(word);
    const clause = or(ilike(assets.prompt, needle), ilike(assets.path, needle));
    if (clause) conditions.push(not(clause));
  }

  if (parsed.types.length > 0) conditions.push(inArray(assets.kind, parsed.types));
  if (parsed.negTypes.length > 0) conditions.push(not(inArray(assets.kind, parsed.negTypes)));
  if (parsed.providers.length > 0) conditions.push(inArray(assets.providerId, parsed.providers));
  if (parsed.sources.length > 0) conditions.push(inArray(assets.source, parsed.sources));
  if (parsed.labels.length > 0) conditions.push(inArray(assets.label, parsed.labels));
  // Tags filter (F-LIB-12): keep only assets carrying every requested tag.
  for (const tag of parsed.tags) {
    const tagged = await state.db
      .select({ assetId: assetTags.assetId })
      .from(assetTags)
      .where(eq(assetTags.tag, tag));
    const ids = tagged.map((row) => row.assetId);
    conditions.push(ids.length > 0 ? inArray(assets.id, ids) : eq(assets.id, '∅'));
  }
  for (const model of parsed.models) conditions.push(ilike(assets.modelId, likeNeedle(model)));
  for (const model of parsed.negModels) conditions.push(not(ilike(assets.modelId, likeNeedle(model))));
  for (const folder of parsed.folders) {
    const clause = or(
      eq(assets.folderPath, folder),
      ilike(assets.folderPath, `${folder.replace(/([\\%_])/g, '\\$1')}/%`),
    );
    if (clause) conditions.push(clause);
  }

  // Filter by character (F-CHR-11, F-LIB-06): resolve each @handle to its id,
  // following one rename alias, then keep only assets with a lineage row for it.
  for (const pin of parsed.handles) {
    const ids = new Set<string>();
    const direct = await state.db
      .select({ id: characters.id })
      .from(characters)
      .where(eq(characters.handle, pin.handle))
      .limit(1);
    if (direct[0]) ids.add(direct[0].id);
    else {
      const alias = await state.db
        .select({ id: characterHandleAliases.characterId })
        .from(characterHandleAliases)
        .where(eq(characterHandleAliases.alias, pin.handle))
        .limit(1);
      if (alias[0]) ids.add(alias[0].id);
    }
    // `@maya` matches any version, `@maya@v2` only that one (PRD-06:245).
    const idClause =
      ids.size > 0 ? inArray(assetCharacters.characterId, [...ids]) : eq(assetCharacters.characterId, '∅');
    const matching = await state.db
      .select({ assetId: assetCharacters.assetId })
      .from(assetCharacters)
      .where(pin.version === undefined ? idClause : and(idClause, eq(assetCharacters.version, pin.version)));
    const assetIds = matching.map((row) => row.assetId);
    conditions.push(assetIds.length > 0 ? inArray(assets.id, assetIds) : eq(assets.id, '∅'));
  }

  // "actual cost in USD (falls back to estimate)" (PRD-06:223): a job that has
  // not settled yet is compared on its estimate rather than skipped.
  const cost = sql`coalesce(${assets.actualUsd}, ${assets.estimateUsd})`;
  if (parsed.costGt !== undefined) conditions.push(sql`${cost} > ${String(parsed.costGt)}`);
  if (parsed.costLt !== undefined) conditions.push(sql`${cost} < ${String(parsed.costLt)}`);
  if (parsed.costEq !== undefined) conditions.push(sql`${cost} = ${String(parsed.costEq)}`);
  if (parsed.ratingGt !== undefined) conditions.push(gt(assets.rating, parsed.ratingGt));
  if (parsed.durGt !== undefined) conditions.push(gt(assets.durationS, String(parsed.durGt)));
  if (parsed.durLt !== undefined) conditions.push(lt(assets.durationS, String(parsed.durLt)));
  if (parsed.since) conditions.push(gte(assets.createdAt, new Date(parsed.since)));
  if (parsed.until) conditions.push(lte(assets.createdAt, new Date(parsed.until)));

  // `ar:` within one percent, so 1080×1920 and 720×1280 both answer ar:9:16.
  if (parsed.aspect) {
    const { ratio } = parsed.aspect;
    conditions.push(
      sql`${assets.width} is not null and ${assets.height} > 0
        and abs((${assets.width}::numeric / ${assets.height}) - ${ratio}) <= ${ratio * 0.01}`,
    );
  }
  if (parsed.resolution) {
    conditions.push(
      sql`least(coalesce(${assets.width}, 0), coalesce(${assets.height}, 0)) >= ${parsed.resolution.minHeight}`,
    );
  }

  // Four of the seven documented flags had no branch, so has:demo and
  // has:moderated returned the whole Library (F-38).
  for (const flag of parsed.has) {
    if (flag === 'nosidecar') conditions.push(eq(assets.sidecarOk, false));
    else if (flag === 'sidecar') conditions.push(eq(assets.sidecarOk, true));
    else if (flag === 'audio') conditions.push(eq(assets.hasAudio, true));
    else if (flag === 'moderated') conditions.push(isNotNull(assets.moderation));
    else if (flag === 'demo') {
      const tagged = await state.db
        .select({ assetId: assetTags.assetId })
        .from(assetTags)
        .where(eq(assetTags.tag, 'demo'));
      const ids = tagged.map((row) => row.assetId);
      conditions.push(ids.length > 0 ? inArray(assets.id, ids) : eq(assets.id, '∅'));
    } else if (flag === 'lineage' || flag === 'mask') {
      // A lineage row records what an asset was made from, with the input's
      // role; `has:mask` is the subset whose input was a mask (TRD-04 §3).
      const rows = await state.db
        .select({ childId: assetLineage.childId })
        .from(assetLineage)
        .where(flag === 'mask' ? eq(assetLineage.role, 'mask') : sql`true`);
      const ids = [...new Set(rows.map((row) => row.childId))];
      conditions.push(ids.length > 0 ? inArray(assets.id, ids) : eq(assets.id, '∅'));
    } else {
      throw new KilnryError(
        'INVALID_INPUT',
        `"has:${flag}" isn't a flag. Try sidecar, nosidecar, audio, mask, lineage, demo or moderated.`,
      );
    }
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
    consistency: row.consistency ?? null,
  }));
}

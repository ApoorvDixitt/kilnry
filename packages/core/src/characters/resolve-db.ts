// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { inArray } from 'drizzle-orm';
import { characters, trainedIdentities, type DatabaseState } from '@kilnry/db';
import type { CanonicalRequest } from '../types.js';
import type { ModelManifest } from '../registry/manifest.js';
import { KilnryError } from '../errors.js';
import { loadRegistry } from '../registry/store.js';
import { loadVersion, lookupHandle, type CharacterHead, type LoadedVersion } from './store.js';
import { resolvePrompt } from './resolve.js';
import type { ResolvedRequest, ResolverCtx, TrainedIdentityInfo } from './resolver-types.js';

// The mention shapes the resolver understands, scanned cheaply so we can pre-load
// their heads and versions before the synchronous resolve pass.
const SCAN =
  /(?:^|[\s(,"'])@([a-z0-9_-]{2,32})(?:@v([1-9][0-9]*))?|<<<([0-9A-HJKMNP-TV-Z]{26})(?:@v([1-9][0-9]*))?>>>/gi;

// A base URL builder for the assets a resolved prompt references. Defaults to the
// loopback media route so the hover preview and the adapter agree.
export type AssetUrl = (assetId: string) => string;

/**
 * Resolve a prompt against a target model using the live database (F-CHR-09 hover
 * preview and the generation path). Pre-loads every mentioned Character head and
 * version, then runs the pure resolver with synchronous lookups.
 */
export async function resolvePromptFromDb(
  db: DatabaseState,
  req: CanonicalRequest,
  model: ModelManifest,
  options: { assetUrl?: AssetUrl } = {},
): Promise<ResolvedRequest> {
  const assetUrl: AssetUrl = options.assetUrl ?? ((id) => `/api/media/${id}`);

  // Collect the handles and versions the prompt or the explicit list references.
  const handles = new Set<string>();
  const pins = new Map<string, Set<number>>();
  SCAN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SCAN.exec(req.prompt)) !== null) {
    const handle = match[1]?.toLowerCase();
    const version = match[2] ? Number(match[2]) : match[4] ? Number(match[4]) : undefined;
    if (handle) {
      handles.add(handle);
      if (version) (pins.get(handle) ?? pins.set(handle, new Set()).get(handle)!).add(version);
    }
  }
  const explicit = (req as { characters?: string[] }).characters ?? [];
  for (const handle of explicit) handles.add(handle.toLowerCase().replace(/^@/, ''));

  // Pre-load heads (direct handles and aliases both go through lookupHandle).
  const headByHandle = new Map<string, CharacterHead>();
  const headById = new Map<string, CharacterHead>();
  const knownHandles: string[] = [];
  const allHeads = await db.db.select({ handle: characters.handle }).from(characters);
  for (const row of allHeads) knownHandles.push(row.handle);
  for (const handle of handles) {
    const head = await lookupHandle(db, handle);
    if (head) {
      headByHandle.set(handle, head);
      headById.set(head.id, head);
    }
  }

  // Pre-load the versions each head needs: its current version plus any pin.
  const versionCache = new Map<string, LoadedVersion>();
  for (const [handle, head] of headByHandle) {
    const wanted = new Set<number>([head.current_version, ...(pins.get(handle) ?? [])]);
    for (const version of wanted) {
      versionCache.set(`${head.id}@v${version}`, await loadVersion(db, head.id, version));
    }
  }

  // Pre-load trained identities for every mentioned head.
  const identitiesById = new Map<string, TrainedIdentityInfo[]>();
  const ids = [...headById.keys()];
  if (ids.length > 0) {
    const rows = await db.db
      .select()
      .from(trainedIdentities)
      .where(inArray(trainedIdentities.characterId, ids));
    for (const row of rows) {
      const list = identitiesById.get(row.characterId) ?? [];
      list.push({
        provider: row.providerId,
        kind: row.kind as TrainedIdentityInfo['kind'],
        status: row.status,
        ...(row.baseModel ? { base_model: row.baseModel } : {}),
        ...(row.triggerWord ? { trigger_word: row.triggerWord } : {}),
        ...(row.defaultScale ? { default_scale: Number(row.defaultScale) } : {}),
        ...(row.artifactUrl ? { artifact_url: row.artifactUrl } : {}),
        ...(row.localPath ? { local_path: row.localPath } : {}),
        ...(row.remoteId ? { remote_id: row.remoteId } : {}),
      });
      identitiesById.set(row.characterId, list);
    }
  }

  const ctx: ResolverCtx = {
    lookupHandle: (h) => headByHandle.get(h.toLowerCase().replace(/^@/, '')) ?? headById.get(h),
    loadVersion: (id, version) => {
      const head = headById.get(id);
      const wanted = version ?? head?.current_version ?? 1;
      const cached = versionCache.get(`${id}@v${wanted}`);
      if (!cached) throw new KilnryError('NOT_FOUND', 'That Character version is not loaded.');
      return cached;
    },
    identitiesFor: (id) => identitiesById.get(id) ?? [],
    assetUrl,
    knownHandles,
  };

  return resolvePrompt(req, model, ctx);
}

// Find a model manifest by its provider model id (e.g. bytedance/seedance-2.5).
export async function findModelManifest(db: DatabaseState, modelId: string): Promise<ModelManifest> {
  const registry = await loadRegistry(db);
  const model = registry.models.find((m) => m.model_id === modelId);
  if (!model) throw new KilnryError('NOT_FOUND', `Model ${modelId} is not in the registry.`);
  return model;
}

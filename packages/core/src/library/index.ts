// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { basename, posix } from 'node:path';
import { rename, rm, stat } from 'node:fs/promises';
import { and, eq } from 'drizzle-orm';
import type { DatabaseState } from '@kilnry/db';
import { assetCharacters, assetLineage, assets, assetTags, folders } from '@kilnry/db';
import { probeMedia, readEmbeddedMetadata } from '@kilnry/media';
import { ulid } from '../ids.js';
import { resolveInRoot } from './containment.js';
import { SidecarSchema, readSidecar, sidecarPath, writeSidecar, type Sidecar } from './sidecar.js';

export function kindForMime(mime: string): Sidecar['kind'] {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'model/gltf-binary') return '3d';
  return 'document';
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = createReadStream(path);
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

function generationFromEmbedded(payload: unknown): Record<string, unknown> | null {
  if (typeof payload !== 'object' || payload === null || !('generation' in payload)) return null;
  const generation = payload.generation;
  return typeof generation === 'object' && generation !== null
    ? (generation as Record<string, unknown>)
    : null;
}

function idFromEmbedded(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null || !('asset_id' in payload)) return undefined;
  return typeof payload.asset_id === 'string' && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(payload.asset_id)
    ? payload.asset_id
    : undefined;
}

export async function buildMinimalSidecar(input: {
  path: string;
  libraryId: string;
  source?: Sidecar['source'];
  embedded?: unknown;
}): Promise<Sidecar> {
  const probe = await probeMedia(input.path);
  const hash = await sha256File(input.path);
  const generation = generationFromEmbedded(input.embedded);
  return SidecarSchema.parse({
    schema_version: 1,
    asset_id: idFromEmbedded(input.embedded) ?? ulid(),
    library_id: input.libraryId,
    file: {
      name: basename(input.path),
      sha256: hash,
      bytes: probe.bytes,
      mime: probe.mime,
      ...(probe.width === undefined ? {} : { width: probe.width }),
      ...(probe.height === undefined ? {} : { height: probe.height }),
      ...(probe.duration_s === undefined ? {} : { duration_s: probe.duration_s }),
      ...(probe.fps === undefined ? {} : { fps: probe.fps }),
      ...(probe.has_audio === undefined ? {} : { has_audio: probe.has_audio }),
    },
    created_at: probe.mtime.toISOString(),
    source: input.source ?? 'import',
    kind: kindForMime(probe.mime),
    generation: generation ? { ...generation, recovered_from: 'embedded' } : null,
    lineage: { made_from: [], used_in: [] },
    tags: generation ? [] : ['needs_prompt'],
    label: null,
    rating: 0,
    user_notes: '',
    consistency: null,
    export: { c2pa: false, iptc_digital_source_type: null },
    trash: null,
  });
}

async function upsertFolder(state: DatabaseState, folder: string): Promise<void> {
  const normalized = folder === '.' ? '' : folder;
  await state.db
    .insert(folders)
    .values({
      path: normalized,
      name: normalized ? posix.basename(normalized) : 'Library',
      parentPath: normalized ? posix.dirname(normalized).replace(/^\.$/, '') : null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({ target: folders.path, set: { updatedAt: new Date() } });
}

async function recoverExternalMove(
  state: DatabaseState,
  root: string,
  destination: string,
  probe: Awaited<ReturnType<typeof probeMedia>>,
  libraryId: string,
): Promise<Sidecar | undefined> {
  const hash = await sha256File(destination);
  const matches = await state.db
    .select({ id: assets.id, path: assets.path })
    .from(assets)
    .where(and(eq(assets.sha256, hash), eq(assets.bytes, probe.bytes), eq(assets.sidecarOk, false)))
    .limit(1);
  const match = matches[0];
  if (!match) return undefined;
  const prior = await resolveInRoot(root, match.path);
  const oldSidecar = await readSidecar(prior.abs);
  if (!oldSidecar.ok) return undefined;
  const value = SidecarSchema.parse({
    ...oldSidecar.value,
    library_id: libraryId,
    file: {
      ...oldSidecar.value.file,
      name: basename(destination),
      sha256: hash,
      bytes: probe.bytes,
      mime: probe.mime,
      ...(probe.width === undefined ? {} : { width: probe.width }),
      ...(probe.height === undefined ? {} : { height: probe.height }),
      ...(probe.duration_s === undefined ? {} : { duration_s: probe.duration_s }),
      ...(probe.fps === undefined ? {} : { fps: probe.fps }),
      ...(probe.has_audio === undefined ? {} : { has_audio: probe.has_audio }),
    },
  });
  await writeSidecar(destination, value);
  await rm(sidecarPath(prior.abs), { force: true });
  return value;
}

export async function indexAsset(
  state: DatabaseState,
  root: string,
  file: string,
  libraryId: string,
): Promise<{ sidecar: Sidecar; recovered: boolean }> {
  await state.ready;
  const resolved = await resolveInRoot(root, file, { mustExist: true });
  const probe = await probeMedia(resolved.abs);
  if (probe.mime === 'application/octet-stream') throw new Error(`Unsupported media type: ${resolved.rel}`);
  const sidecarResult = await readSidecar(resolved.abs);
  let sidecar: Sidecar;
  let recovered = false;
  if (sidecarResult.ok) sidecar = sidecarResult.value;
  else {
    if (sidecarResult.bytes) {
      await rename(sidecarPath(resolved.abs), `${sidecarPath(resolved.abs)}.corrupt-${Date.now()}`);
    }
    const moved = await recoverExternalMove(state, root, resolved.abs, probe, libraryId);
    if (moved) sidecar = moved;
    else {
      const embedded = await readEmbeddedMetadata(resolved.abs, probe.mime);
      sidecar = await buildMinimalSidecar({
        path: resolved.abs,
        libraryId,
        embedded: embedded.payload,
      });
      await writeSidecar(resolved.abs, sidecar);
      recovered = embedded.payload !== undefined;
    }
  }
  const folder = posix.dirname(resolved.rel).replace(/^\.$/, '');
  await upsertFolder(state, folder);
  const generation = sidecar.generation;
  await state.db
    .insert(assets)
    .values({
      id: sidecar.asset_id,
      path: resolved.rel,
      folderPath: folder,
      kind: sidecar.kind,
      mime: sidecar.file.mime,
      bytes: sidecar.file.bytes,
      sha256: sidecar.file.sha256,
      width: sidecar.file.width,
      height: sidecar.file.height,
      durationS: sidecar.file.duration_s?.toFixed(3),
      fps: sidecar.file.fps?.toFixed(2),
      hasAudio: sidecar.file.has_audio,
      source: sidecar.source,
      providerId: typeof generation?.provider === 'string' ? generation.provider : null,
      modelId: typeof generation?.model === 'string' ? generation.model : null,
      prompt: typeof generation?.prompt === 'string' ? generation.prompt : null,
      resolvedPrompt: typeof generation?.resolved_prompt === 'string' ? generation.resolved_prompt : null,
      negativePrompt: typeof generation?.negative_prompt === 'string' ? generation.negative_prompt : null,
      params:
        typeof generation?.params === 'object' && generation.params !== null
          ? (generation.params as Record<string, unknown>)
          : null,
      estimateUsd: typeof generation?.estimate_usd === 'number' ? generation.estimate_usd.toFixed(6) : null,
      actualUsd: typeof generation?.actual_usd === 'number' ? generation.actual_usd.toFixed(6) : null,
      jobId: typeof generation?.job_id === 'string' ? generation.job_id : null,
      providerRequestId:
        typeof generation?.provider_request_id === 'string' ? generation.provider_request_id : null,
      label: sidecar.label,
      rating: sidecar.rating,
      userNotes: sidecar.user_notes,
      sidecarOk: true,
      sidecarMtime: (await stat(`${resolved.abs}.kilnry.json`)).mtime,
      fileMtime: probe.mtime,
      createdAt: new Date(sidecar.created_at),
      indexedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: assets.id,
      set: {
        path: resolved.rel,
        folderPath: folder,
        mime: sidecar.file.mime,
        bytes: sidecar.file.bytes,
        sha256: sidecar.file.sha256,
        sidecarOk: true,
        fileMtime: probe.mtime,
        indexedAt: new Date(),
      },
    });
  await state.db.delete(assetTags).where(eq(assetTags.assetId, sidecar.asset_id));
  if (sidecar.tags.length > 0)
    await state.db.insert(assetTags).values(sidecar.tags.map((tag) => ({ assetId: sidecar.asset_id, tag })));
  await state.db.delete(assetLineage).where(eq(assetLineage.childId, sidecar.asset_id));
  if (sidecar.lineage.made_from.length > 0)
    await state.db.insert(assetLineage).values(
      sidecar.lineage.made_from.map((parentId) => ({
        childId: sidecar.asset_id,
        parentId,
        role: 'made_from',
      })),
    );
  await state.db.delete(assetCharacters).where(eq(assetCharacters.assetId, sidecar.asset_id));
  return { sidecar, recovered };
}

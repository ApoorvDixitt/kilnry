// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { and, asc, desc, eq, isNotNull, isNull, like, lt, or, type SQL } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { assets, auditEvents, settings, type DatabaseState } from '@kilnry/db';
import { KilnryError } from '../errors.js';
import { resolveInRoot } from './containment.js';
import { indexAsset } from './index.js';
import { readSidecar, sidecarPath, type Sidecar } from './sidecar.js';

export type AssetSort = 'newest' | 'oldest' | 'name' | 'cost' | 'duration';

export interface AssetListItem {
  id: string;
  path: string;
  folder_path: string | null;
  kind: string;
  mime: string | null;
  width: number | null;
  height: number | null;
  duration_s: number | null;
  has_audio: boolean | null;
  provider_id: string | null;
  actual_usd: number | null;
  estimate_usd: number | null;
  sidecar_ok: boolean;
  created_at: string;
  // The consistency check's badge summary, when the asset was scored (F-CHR-12).
  consistency: Record<string, unknown> | null;
}

export interface ListAssetsOptions {
  folder: string;
  includeSubfolders?: boolean;
  sort?: AssetSort;
}

function sortOrder(sort: AssetSort): SQL[] {
  switch (sort) {
    case 'oldest':
      return [asc(assets.createdAt)];
    case 'name':
      return [asc(assets.path)];
    case 'cost':
      return [desc(assets.actualUsd), desc(assets.estimateUsd)];
    case 'duration':
      return [desc(assets.durationS)];
    default:
      return [desc(assets.createdAt)];
  }
}

// List the assets in a folder for the grid. Trashed assets are excluded here;
// the Trash view queries them separately. Subfolders are included on request by
// matching the folder path prefix.
export async function listAssets(state: DatabaseState, options: ListAssetsOptions): Promise<AssetListItem[]> {
  const folder = options.folder.replace(/\/+$/, '');
  const folderMatch = options.includeSubfolders
    ? or(eq(assets.folderPath, folder), like(assets.folderPath, `${folder}/%`))
    : eq(assets.folderPath, folder);

  const rows = await state.db
    .select()
    .from(assets)
    .where(and(isNull(assets.trashedAt), folderMatch))
    .orderBy(...sortOrder(options.sort ?? 'newest'))
    .limit(20_000);

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

export interface MetadataPatch {
  tags?: string[] | undefined;
  label?: string | null | undefined;
  rating?: number | undefined;
  user_notes?: string | undefined;
  prompt?: string | undefined;
}

const TAG_PATTERN = /^[a-z0-9_-]{1,32}$/;

// Apply user metadata edits to an asset. The change is written to the sidecar
// first (atomically, temp file then rename), then the index is refreshed from
// that sidecar, honouring the sidecar-first rule. A prompt is only accepted for
// an imported asset that has no generation recipe of its own.
export async function updateAssetMetadata(
  state: DatabaseState,
  root: string,
  libraryId: string,
  assetId: string,
  patch: MetadataPatch,
): Promise<void> {
  const [row] = await state.db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
  if (!row) throw new KilnryError('NOT_FOUND', 'That asset is not in the Library.');
  const resolved = await resolveInRoot(root, row.path, { mustExist: true });
  const existing = await readSidecar(resolved.abs);
  if (!existing.ok) throw new KilnryError('INVALID_INPUT', 'That asset has no readable metadata file.');

  const next: Sidecar = { ...existing.value };
  if (patch.tags) {
    const invalid = patch.tags.find((tag) => !TAG_PATTERN.test(tag));
    if (invalid) throw new KilnryError('INVALID_INPUT', `The tag "${invalid}" is not allowed.`);
    next.tags = Array.from(new Set(patch.tags));
  }
  if (patch.label !== undefined) next.label = patch.label;
  if (patch.rating !== undefined) {
    if (patch.rating < 0 || patch.rating > 5) throw new KilnryError('INVALID_INPUT', 'A rating is 0 to 5.');
    next.rating = patch.rating;
  }
  if (patch.user_notes !== undefined) next.user_notes = patch.user_notes;
  if (patch.prompt !== undefined) {
    if (next.generation && Object.keys(next.generation).length > 0) {
      throw new KilnryError('INVALID_INPUT', 'This asset already has a recipe; its prompt is read-only.');
    }
    next.generation = { prompt: patch.prompt, provider: null, source: 'import' };
  }

  await writeSidecarExact(resolved.abs, next);
  await indexAsset(state, root, resolved.abs, libraryId);
}

// Write a sidecar exactly as given, atomically, without the field-preserving
// merge that writeSidecar applies for freshly generated assets.
async function writeSidecarExact(assetPath: string, value: Sidecar): Promise<void> {
  const path = sidecarPath(assetPath);
  const temporary = `${path}.tmp-${process.pid}-${randomBytes(3).toString('hex')}`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
}

export interface AssetActivity {
  action: string;
  actor: string | null;
  at: string;
}

export interface AssetDetail extends AssetListItem {
  sha256: string | null;
  bytes: number | null;
  model_id: string | null;
  file_mtime: string | null;
  indexed_at: string;
  tags: string[];
  label: string | null;
  rating: number;
  user_notes: string;
  generation: Record<string, unknown> | null;
  lineage: { made_from: string[]; used_in: string[] };
  sidecar_path: string;
  activity: AssetActivity[];
  /**
   * When the provider's own copy expires (PRD-14:223's seven-day Higgsfield
   * window), and whether the local file is still on disk. Both were stored and
   * neither was reported, so nothing could show "Provider copy expired; local
   * file missing" (F-45).
   */
  retention_until: string | null;
  file_present: boolean;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// The full detail an inspector needs for one asset: the index row, the metadata
// the sidecar holds, and the activity timeline recorded for it.
export async function getAssetDetail(
  state: DatabaseState,
  root: string,
  assetId: string,
): Promise<AssetDetail> {
  const [row] = await state.db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
  if (!row) throw new KilnryError('NOT_FOUND', 'That asset is not in the Library.');
  const resolved = await resolveInRoot(root, row.path, { mustExist: false });
  const sidecar = await readSidecar(resolved.abs);
  const events = await state.db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.target, assetId))
    .orderBy(asc(auditEvents.createdAt))
    .limit(200);

  return {
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
    sha256: row.sha256,
    bytes: row.bytes,
    model_id: row.modelId,
    file_mtime: row.fileMtime ? row.fileMtime.toISOString() : null,
    indexed_at: row.indexedAt.toISOString(),
    tags: sidecar.ok ? sidecar.value.tags : [],
    label: sidecar.ok ? sidecar.value.label : row.label,
    rating: sidecar.ok ? sidecar.value.rating : row.rating,
    user_notes: sidecar.ok ? sidecar.value.user_notes : (row.userNotes ?? ''),
    generation: sidecar.ok ? sidecar.value.generation : null,
    lineage: sidecar.ok ? sidecar.value.lineage : { made_from: [], used_in: [] },
    sidecar_path: `${row.path}.kilnry.json`,
    retention_until: row.retentionUntil ? row.retentionUntil.toISOString() : null,
    file_present: await fileExists(resolved.abs),
    activity: events.map((event) => ({
      action: event.action,
      actor: event.actor,
      at: event.createdAt.toISOString(),
    })),
  };
}

// Move an asset and its sidecar into Trash/, stamping the sidecar's trash block
// with when and where it came from, and recording trashedAt/originalPath in the
// index so it can be restored later.
export async function deleteAssetToTrash(
  state: DatabaseState,
  root: string,
  libraryId: string,
  assetId: string,
  now: Date = new Date(),
): Promise<void> {
  const [row] = await state.db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
  if (!row) throw new KilnryError('NOT_FOUND', 'That asset is not in the Library.');
  const source = await resolveInRoot(root, row.path, { mustExist: true });
  const originalRel = row.path;
  const base = originalRel.split('/').at(-1)!;
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const trashRel = `Trash/${stamp}__${base}`;
  const target = join(root, trashRel);
  await mkdir(dirname(target), { recursive: true });

  const sidecar = await readSidecar(source.abs);
  await rename(source.abs, target);
  const sourceSidecar = sidecarPath(source.abs);
  const targetSidecar = sidecarPath(target);
  if (sidecar.ok) {
    const next: Sidecar = {
      ...sidecar.value,
      trash: { deleted_at: now.toISOString(), original_path: originalRel },
    };
    await writeSidecarExact(target, next);
    await unlinkIfExists(sourceSidecar);
  } else {
    await renameIfExists(sourceSidecar, targetSidecar);
  }

  await state.db
    .update(assets)
    .set({ path: trashRel, folderPath: 'Trash', trashedAt: now, originalPath: originalRel })
    .where(eq(assets.id, assetId));
  void libraryId;
}

// Restore a trashed asset to its original path, recreating folders as needed and
// clearing the trash block from the sidecar and the index.
export async function restoreAsset(state: DatabaseState, root: string, assetId: string): Promise<void> {
  const [row] = await state.db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
  if (!row) throw new KilnryError('NOT_FOUND', 'That asset is not in the Library.');
  if (!row.originalPath) throw new KilnryError('INVALID_INPUT', 'That asset has no original location.');
  const currentAbs = join(root, row.path);
  if (!(await pathExists(currentAbs))) {
    throw new KilnryError('NOT_FOUND', 'The trashed file is missing.');
  }
  let destinationRel = row.originalPath;
  // If something already occupies the original path, restore alongside it.
  if (await pathExists(join(root, destinationRel))) {
    const dot = destinationRel.lastIndexOf('.');
    destinationRel =
      dot > 0
        ? `${destinationRel.slice(0, dot)}-restored${destinationRel.slice(dot)}`
        : `${destinationRel}-restored`;
  }
  const destination = join(root, destinationRel);
  await mkdir(dirname(destination), { recursive: true });
  await rename(currentAbs, destination);
  await renameIfExists(sidecarPath(currentAbs), sidecarPath(destination));

  const sidecar = await readSidecar(destination);
  if (sidecar.ok) {
    const next: Sidecar = { ...sidecar.value, trash: null };
    await writeSidecarExact(destination, next);
  }
  await state.db
    .update(assets)
    .set({
      path: destinationRel,
      folderPath: destinationRel.includes('/') ? destinationRel.split('/').slice(0, -1).join('/') : null,
      trashedAt: null,
      originalPath: null,
    })
    .where(eq(assets.id, assetId));
}

async function unlinkIfExists(path: string): Promise<void> {
  try {
    await rm(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

async function renameIfExists(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// Rebuild one asset's sidecar from its embedded metadata (F-LIB-11 single-asset
// recover). Re-indexing reads the file's PNG iTXt, A1111 parameters, XMP, MP4 or
// ID3 tags and writes a fresh sidecar; returns whether embedded data was found.
export async function recoverAssetMetadata(
  state: DatabaseState,
  root: string,
  libraryId: string,
  assetId: string,
): Promise<{ recovered: boolean }> {
  const [row] = await state.db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
  if (!row) throw new KilnryError('NOT_FOUND', 'That asset is not in the Library.');
  const { indexAsset } = await import('./index.js');
  const absolute = join(root, row.path);
  // Remove the stale index row first so re-indexing inserts cleanly; the file and
  // any embedded metadata are the source of truth for the rebuilt sidecar.
  await state.db.delete(assets).where(eq(assets.id, assetId));
  const result = await indexAsset(state, root, absolute, libraryId);
  return { recovered: result.recovered };
}

/**
 * The nightly Trash purge (TRD-04 §5 invariant 2, TRD-08:342 `trash_purge` at
 * 30 3 * * *): delete the asset row, its file and its sidecar once it has been
 * in Trash longer than `settings.trash_days` (30, default; adjustable). The
 * move-to-Trash half was built and this half was not, so nothing read
 * trash_days and a user's Trash was never emptied (F-32).
 */
export const TRASH_DAYS_SETTING = 'trash_days';
export const TRASH_DAYS_DEFAULT = 30;

export async function trashDays(state: DatabaseState): Promise<number> {
  const rows = await state.db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, TRASH_DAYS_SETTING))
    .limit(1);
  const stored = Number(rows[0]?.value);
  if (!Number.isFinite(stored)) return TRASH_DAYS_DEFAULT;
  return Math.min(365, Math.max(1, Math.round(stored)));
}

export async function purgeTrash(
  state: DatabaseState,
  libraryRoot: string,
  now: Date = new Date(),
): Promise<{ purged: number }> {
  const days = await trashDays(state);
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const rows = await state.db
    .select({ id: assets.id, path: assets.path })
    .from(assets)
    .where(and(isNotNull(assets.trashedAt), lt(assets.trashedAt, cutoff)));
  let purged = 0;
  for (const row of rows) {
    // These are Kilnry's own Trash paths, which resolveInRoot refuses as a
    // reserved segment (it guards user input), so containment is checked here:
    // the resolved file must sit under <root>/Trash and nowhere else.
    const absolute = resolve(libraryRoot, row.path);
    const trashRoot = resolve(libraryRoot, 'Trash');
    if (absolute !== trashRoot && !absolute.startsWith(`${trashRoot}${sep}`)) {
      throw new KilnryError(
        'INVALID_INPUT',
        `Refusing to purge ${row.path}: it is not inside the Library's Trash.`,
      );
    }
    await rm(absolute, { force: true });
    await rm(sidecarPath(absolute), { force: true });
    await state.db.delete(assets).where(eq(assets.id, row.id));
    purged += 1;
  }
  return { purged };
}

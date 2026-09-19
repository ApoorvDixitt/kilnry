// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { and, asc, desc, eq, isNull, like, or, type SQL } from 'drizzle-orm';
import { assets, type DatabaseState } from '@kilnry/db';

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
  }));
}

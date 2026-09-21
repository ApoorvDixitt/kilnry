// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Disk-space watch and cache clearing (F-LIB-13, PRD-06 §14). Kilnry warns at
// 90% used or under 5 GB free, and pauses downloads under 1 GB free. The cache
// (thumbnails, previews, sprites) is regenerable, so Clear cache empties it.

import { rm, mkdir, readdir, stat, statfs } from 'node:fs/promises';
import { join } from 'node:path';

export const WARN_FRACTION = 0.9;
export const WARN_FREE_BYTES = 5 * 1024 * 1024 * 1024;
export const PAUSE_FREE_BYTES = 1 * 1024 * 1024 * 1024;

export interface DiskStatus {
  total_bytes: number;
  free_bytes: number;
  used_fraction: number;
  cache_bytes: number;
  level: 'ok' | 'warn' | 'pause';
}

// The free bytes and total on the volume that holds a path.
export async function volumeSpace(path: string): Promise<{ total: number; free: number }> {
  const fs = await statfs(path);
  return { total: fs.blocks * fs.bsize, free: fs.bavail * fs.bsize };
}

// The size of a directory tree, in bytes (used for the cache figure).
export async function directorySize(dir: string): Promise<number> {
  let total = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) total += await directorySize(full);
    else {
      const info = await stat(full).catch(() => undefined);
      if (info) total += info.size;
    }
  }
  return total;
}

// The disk status for the banner: the warning level plus the cache size.
export async function diskStatus(dataDir: string): Promise<DiskStatus> {
  const { total, free } = await volumeSpace(dataDir);
  const cacheBytes = await directorySize(join(dataDir, 'cache'));
  const usedFraction = total > 0 ? (total - free) / total : 0;
  const level: DiskStatus['level'] =
    free < PAUSE_FREE_BYTES
      ? 'pause'
      : usedFraction >= WARN_FRACTION || free < WARN_FREE_BYTES
        ? 'warn'
        : 'ok';
  return {
    total_bytes: total,
    free_bytes: free,
    used_fraction: usedFraction,
    cache_bytes: cacheBytes,
    level,
  };
}

// Whether a download may proceed: false when under 1 GB free (§14).
export function mayDownload(status: Pick<DiskStatus, 'free_bytes'>): boolean {
  return status.free_bytes >= PAUSE_FREE_BYTES;
}

// Empty the regenerable cache and return the bytes reclaimed. Thumbnails and
// previews regenerate lazily afterwards.
export async function clearCache(dataDir: string): Promise<number> {
  const cache = join(dataDir, 'cache');
  const before = await directorySize(cache);
  await rm(cache, { recursive: true, force: true });
  await mkdir(cache, { recursive: true, mode: 0o700 });
  return before;
}

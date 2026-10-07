// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Framework-free helpers for the disk-space banner (F-LIB-13), unit-tested
// without a browser. The banner copy and numbers must match PRD-06 §14 exactly.

export interface DiskStatusView {
  total_bytes: number;
  free_bytes: number;
  used_fraction: number;
  cache_bytes: number;
  level: 'ok' | 'warn' | 'pause';
}

const GB = 1024 * 1024 * 1024;

// A byte count as whole gigabytes (PRD-06 §14 shows "18 GB free").
export function gb(bytes: number): string {
  return `${Math.round(bytes / GB)} GB`;
}

/**
 * The warning copy. It used to lead with a percentage computed from the bytes
 * the filesystem reports as available, which on APFS excludes purgeable space:
 * a machine 69 % full by `df` was told it was 98 % full, and it was offered a
 * Clear cache button for a cache of 0.0 GB that would clear nothing (UX-06).
 * The free figure and the pause threshold are the facts the user can act on,
 * and the cache is only mentioned when there is some to clear.
 */
export function warnBannerText(status: DiskStatusView): string {
  const free = `${(status.free_bytes / GB).toFixed(1)} GB free on this disk`;
  const pause = 'Kilnry pauses imports under 1 GB.';
  if (status.cache_bytes < 0.05 * GB) return `${free}; ${pause}`;
  const cacheGb = (status.cache_bytes / GB).toFixed(1);
  return `${free}; ${pause} Kilnry's cache holds ${cacheGb} GB.`;
}

/** Whether there is enough cache to be worth offering to clear (UX-06). */
export function cacheWorthClearing(status: DiskStatusView): boolean {
  return status.cache_bytes >= 0.05 * GB;
}

// The coral pause banner copy when under 1 GB free.
export function pauseBannerText(): string {
  return 'Not enough disk space to save results. Free at least 1 GB.';
}

export function shouldShowBanner(status: DiskStatusView): boolean {
  return status.level !== 'ok';
}

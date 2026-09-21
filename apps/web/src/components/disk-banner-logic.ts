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

// The warning banner copy for a warn-level status (PRD-06 §14, exact wording):
// "Your disk is 92 % full (18 GB free). Free space or clear Kilnry's cache
// (2.1 GB)."
export function warnBannerText(status: DiskStatusView): string {
  const percent = Math.round(status.used_fraction * 100);
  const cacheGb = (status.cache_bytes / GB).toFixed(1);
  return `Your disk is ${percent} % full (${gb(status.free_bytes)} free). Free space or clear Kilnry's cache (${cacheGb} GB).`;
}

// The coral pause banner copy when under 1 GB free.
export function pauseBannerText(): string {
  return 'Not enough disk space to save results. Free at least 1 GB.';
}

export function shouldShowBanner(status: DiskStatusView): boolean {
  return status.level !== 'ok';
}

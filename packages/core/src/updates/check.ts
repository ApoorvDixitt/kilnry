// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Update check (F-SET-07, TRD-18 §1). Kilnry checks a release manifest ONLY when
// the user clicks "Check now" or has turned on automatic checks (default off,
// F-NFR-02: no network call unless the user configured a provider or asked). The
// check is a single GET of manifest.json for the chosen channel; no other data
// is ever sent. The download / verify / swap of the new version is the
// launcher's job (M8); this module reads the manifest and names the state.

import { appVersion } from '../version.js';

const DEFAULT_RELEASES_BASE = 'https://github.com/ApoorvDixitt/kilnry/releases';

export type UpdateChannel = 'stable' | 'beta';

// The subset of the release manifest the page reads (TRD-18 §1 draws the rest).
export interface ReleaseManifest {
  version: string;
  released_at?: string;
  notes?: string;
}

export type UpdateState =
  | { status: 'up_to_date'; current: string; channel: UpdateChannel }
  | {
      status: 'available';
      current: string;
      latest: string;
      channel: UpdateChannel;
      released_at?: string;
      notes?: string;
    }
  | { status: 'offline'; current: string; channel: UpdateChannel };

export interface CheckUpdateOptions {
  fetch?: typeof fetch;
  channel?: UpdateChannel;
  // Overridable for an air-gapped mirror or a test fixture (KILNRY_RELEASES_BASE).
  releasesBase?: string;
  currentVersion?: string;
}

// Compare two dotted semver cores (ignoring any pre-release suffix). Returns > 0
// when a is newer than b.
export function compareSemver(a: string, b: string): number {
  const parse = (v: string): number[] =>
    v
      .replace(/^v/, '')
      .split('-')[0]!
      .split('.')
      .map((n) => Number.parseInt(n, 10) || 0);
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < 3; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// The manifest URL for a channel. Stable reads releases/latest; beta reads a
// channel-specific path (TRD-18 §1 line 45).
export function manifestUrl(base: string, channel: UpdateChannel): string {
  const root = base.replace(/\/$/, '');
  return channel === 'beta' ? `${root}/download/beta/manifest.json` : `${root}/latest/download/manifest.json`;
}

export async function checkForUpdate(options: CheckUpdateOptions = {}): Promise<UpdateState> {
  const fetchImpl = options.fetch ?? fetch;
  const channel = options.channel ?? 'stable';
  const current = options.currentVersion ?? appVersion();
  const base = options.releasesBase ?? process.env.KILNRY_RELEASES_BASE ?? DEFAULT_RELEASES_BASE;
  let manifest: ReleaseManifest;
  try {
    const response = await fetchImpl(manifestUrl(base, channel), { headers: { Accept: 'application/json' } });
    if (!response.ok) return { status: 'offline', current, channel };
    manifest = (await response.json()) as ReleaseManifest;
  } catch {
    // No network, or the host is unreachable: the page shows "can't check while
    // offline"; it never implies a failure of the user's own setup.
    return { status: 'offline', current, channel };
  }
  if (!manifest.version || compareSemver(manifest.version, current) <= 0) {
    return { status: 'up_to_date', current, channel };
  }
  return {
    status: 'available',
    current,
    latest: manifest.version,
    channel,
    ...(manifest.released_at ? { released_at: manifest.released_at } : {}),
    ...(manifest.notes ? { notes: manifest.notes } : {}),
  };
}

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The About page's data (F-SET-11, PRD-16 §11): the running build facts, the
// Sustainable Use License summary, the third-party licence inventory read from
// the generated THIRD_PARTY_NOTICES.md, and a redacted diagnostics bundle. No
// telemetry, no accounts server (D-10/D-14): everything here is read locally.

import { spawnSync } from 'node:child_process';
import { appVersion } from '../version.js';
import { defaultDataDir } from '../config/load.js';
import { BUILD_PINS } from './versions.generated.js';

// FFmpeg is a separate process (TRD-02), so its version is read by spawning it
// once with a short timeout; absent, the build line says so rather than lying.
function ffmpegVersion(binary = process.env.KILNRY_FFMPEG ?? 'ffmpeg'): string {
  const result = spawnSync(binary, ['-version'], { encoding: 'utf8', timeout: 4000 });
  const match = /ffmpeg version\s+(\S+)/i.exec(result.stdout ?? '');
  return match?.[1] ?? 'not found';
}

export interface AboutInfo {
  version: string;
  platform: string;
  arch: string;
  node: string;
  next: string;
  pglite: string;
  ffmpeg: string;
  data_dir: string;
  // The one-line "Server build …" string the page renders verbatim.
  build_line: string;
  license: string;
  license_url: string;
  no_telemetry: string;
}

// The verbatim licence summary (PRD-16 §11; the full text is LICENSE.md).
export const LICENSE_SUMMARY =
  'Sustainable Use License 1.0 (fair-code). You may self-host and use Kilnry commercially for your own work. You may not sell Kilnry as a hosted service or rebrand it.';

export function aboutInfo(): AboutInfo {
  const version = appVersion();
  const platform = process.platform;
  const arch = process.arch;
  const node = process.version.replace(/^v/, '');
  // Build-time pins (PRD-16 §11). A runtime `require` from core could not find
  // either package and printed "unknown" (F-61); Node and ffmpeg stay runtime.
  const next = BUILD_PINS.next;
  const pglite = BUILD_PINS.pglite;
  const ffmpeg = ffmpegVersion();
  return {
    version,
    platform,
    arch,
    node,
    next,
    pglite,
    ffmpeg,
    data_dir: defaultDataDir(),
    build_line: `Server build ${version} (${platform}-${arch}) · Node ${node} · Next ${next} · PGlite ${pglite} · ffmpeg ${ffmpeg}`,
    license: LICENSE_SUMMARY,
    // The licence opens from the bundled LICENSE.md, served locally — no egress
    // to github.com (F-NFR-02).
    license_url: '/api/about/license',
    no_telemetry: 'No paywalls, no telemetry, no accounts server.',
  };
}

export interface ThirdPartyPackage {
  name: string;
  version: string;
  license: string;
}

// Parse the generated THIRD_PARTY_NOTICES.md back into a list the page renders.
// The file groups packages under `### <SPDX licence>` headings, each entry a
// `- <name> <version>[, <version>…]` bullet. We read the first version so each
// package appears once with its licence (F-SET-11 acceptance: a production
// dependency is listed with its licence; a dev-only tool such as vitest is not,
// because the generator used `pnpm licenses list --prod`).
export function parseThirdPartyNotices(markdown: string): ThirdPartyPackage[] {
  const packages: ThirdPartyPackage[] = [];
  let license = '';
  for (const line of markdown.split('\n')) {
    const heading = /^### (.+)$/.exec(line);
    if (heading) {
      license = heading[1]!.trim();
      continue;
    }
    const bullet = /^- (\S+) (\d[^,\s]*)/.exec(line);
    if (bullet && license) {
      packages.push({ name: bullet[1]!, version: bullet[2]!, license });
    }
  }
  return packages.sort((a, b) => a.name.localeCompare(b.name));
}

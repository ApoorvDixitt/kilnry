// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The About page's data (F-SET-11, PRD-16 §11): the running version and build
// facts, the Sustainable Use License summary, and the third-party dependency
// inventory generated from pnpm-lock.yaml. No telemetry, no accounts server
// (D-10/D-14): everything here is read locally.

import { appVersion } from '../version.js';

export interface AboutInfo {
  version: string;
  node: string;
  platform: string;
  arch: string;
  license: string;
  license_url: string;
  no_telemetry: string;
}

// The verbatim licence summary (PRD-16 §11; the full text is LICENSE.md).
export const LICENSE_SUMMARY =
  'Sustainable Use License 1.0 (fair-code). You may self-host and use Kilnry commercially for your own work. You may not sell Kilnry as a hosted service or rebrand it.';

export function aboutInfo(): AboutInfo {
  return {
    version: appVersion(),
    node: process.version.replace(/^v/, ''),
    platform: process.platform,
    arch: process.arch,
    license: LICENSE_SUMMARY,
    license_url: 'https://github.com/ApoorvDixitt/kilnry/blob/main/LICENSE.md',
    no_telemetry: 'No paywalls, no telemetry, no accounts server.',
  };
}

export interface ThirdPartyPackage {
  name: string;
  version: string;
}

// Parse the dependency inventory out of a pnpm-lock.yaml (lockfileVersion 9):
// every entry under `packages:` is keyed `'name@version':`, where name may be a
// scoped `@scope/pkg` and version may carry a peer-suffix in parentheses. We
// read only names and versions — never integrity hashes or resolution URLs — so
// the notice is a plain inventory a reader can audit (F-SET-11, THIRD_PARTY_NOTICES).
export function parseLockfilePackages(lockfile: string): ThirdPartyPackage[] {
  const lines = lockfile.split('\n');
  const start = lines.findIndex((line) => line === 'packages:');
  if (start === -1) return [];
  const seen = new Map<string, string>();
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    // The next top-level section (a non-indented key) ends the packages block.
    if (/^\S/.test(line) && line.trim() !== '') break;
    // A package entry is indented two spaces: `  'name@version':` or `  name@version:`.
    const match = /^ {2}'?((?:@[^/]+\/)?[^@'\s][^@']*)@([^():'\s]+)(?:\([^)]*\))*'?:\s*$/.exec(line);
    if (!match) continue;
    const name = match[1]!;
    const version = match[2]!;
    // Keep the first version seen for a name; the inventory lists each once.
    if (!seen.has(name)) seen.set(name, version);
  }
  return [...seen.entries()]
    .map(([name, version]) => ({ name, version }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Generate THIRD_PARTY_NOTICES.md from the production dependency tree
// (F-SET-11, PRD-16 §11). The source of truth is `pnpm licenses list --prod
// --json`, which lists only the packages that ship in a release — never the dev
// toolchain (vitest, playwright, eslint). pnpm's docs for `licenses list`:
// https://pnpm.io/cli/licenses — `--prod` restricts to "dependencies"
// (production), `--json` emits an object keyed by SPDX licence, each value an
// array of { name, versions, paths, license, homepage }.
//
// FFmpeg is NOT an npm dependency: it is a GPL binary Kilnry spawns as a
// separate process and never links (TRD-02 §2 line 81), so it is noted by hand.

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface LicenseEntry {
  name: string;
  versions: string[];
  license: string;
  homepage?: string;
}

function readProdLicenses(): Map<string, LicenseEntry[]> {
  const result = spawnSync('pnpm', ['licenses', 'list', '--prod', '--json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error(`pnpm licenses list --prod --json failed: ${result.stderr || 'no output'}`);
  }
  const raw = JSON.parse(result.stdout) as Record<string, LicenseEntry[]>;
  return new Map(Object.entries(raw));
}

function render(byLicense: Map<string, LicenseEntry[]>): string {
  const lines: string[] = [];
  lines.push('# Third-party notices');
  lines.push('');
  lines.push(
    'Kilnry bundles the production dependencies below under their own licences. This file is generated from `pnpm licenses list --prod --json`; the development toolchain is not shipped and is not listed. Run `pnpm gen:notices` to refresh it.',
  );
  lines.push('');
  lines.push('## FFmpeg');
  lines.push('');
  lines.push(
    'FFmpeg (GPL) is not an npm dependency. Kilnry invokes a system or pinned-static FFmpeg 7 binary as a separate process and never links against it (TRD-02). Its source and licence travel with the FFmpeg distribution.',
  );
  lines.push('');
  lines.push('## Fonts');
  lines.push('');
  lines.push('Geist and Geist Mono are used under the SIL Open Font License 1.1 and are self-hosted.');
  lines.push('');
  lines.push('## npm dependencies (production)');
  lines.push('');
  for (const license of [...byLicense.keys()].sort((a, b) => a.localeCompare(b))) {
    const entries = [...byLicense.get(license)!].sort((a, b) => a.name.localeCompare(b.name));
    lines.push(`### ${license}`);
    lines.push('');
    for (const entry of entries) {
      lines.push(`- ${entry.name} ${entry.versions.join(', ')}`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}`.replace(/\n+$/, '\n');
}

const output = join(process.cwd(), 'THIRD_PARTY_NOTICES.md');
const markdown = render(readProdLicenses());
const footer = '\n<!-- Kilnry © 2026 Apoorv Dixit · Sustainable Use License 1.0 · See LICENSE.md. -->\n';
writeFileSync(output, markdown + footer, 'utf8');
process.stdout.write(`Wrote ${output} from pnpm licenses list --prod --json.\n`);

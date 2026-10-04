// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { aboutInfo, LICENSE_SUMMARY, parseLockfilePackages } from './info.js';

const LOCKFILE = `lockfileVersion: '9.0'

importers:
  .:
    dependencies: {}

packages:
  '@scope/pkg-a@1.2.3':
    resolution: { integrity: sha512-abc== }
  react@19.0.0:
    resolution: { integrity: sha512-def== }
  react@19.0.0(peer@1.0.0):
    resolution: { integrity: sha512-ghi== }
  'zod@4.1.0':
    resolution: { integrity: sha512-jkl== }

snapshots:
  react@19.0.0: {}
`;

describe('about info (F-SET-11)', () => {
  it('reports the running version and build facts', () => {
    const info = aboutInfo();
    expect(info.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(info.node).toBe(process.version.replace(/^v/, ''));
    expect(info.license).toBe(LICENSE_SUMMARY);
    expect(info.no_telemetry).toContain('no telemetry');
  });

  it('parses a plain name/version inventory from the lockfile, deduped and sorted', () => {
    const packages = parseLockfilePackages(LOCKFILE);
    const names = packages.map((p) => p.name);
    expect(names).toEqual(['@scope/pkg-a', 'react', 'zod']);
    expect(packages.find((p) => p.name === 'react')?.version).toBe('19.0.0');
    expect(packages.find((p) => p.name === '@scope/pkg-a')?.version).toBe('1.2.3');
    // Only the packages block is read, never snapshots or integrity hashes.
    expect(JSON.stringify(packages)).not.toContain('sha512');
  });

  it('returns an empty inventory for a lockfile with no packages block', () => {
    expect(parseLockfilePackages('lockfileVersion: "9.0"\n')).toEqual([]);
  });
});

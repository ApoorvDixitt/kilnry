// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { aboutInfo, LICENSE_SUMMARY, parseThirdPartyNotices } from './info.js';

const NOTICES = `# Third-party notices

## FFmpeg

FFmpeg (GPL) is not an npm dependency.

## npm dependencies (production)

### Apache-2.0

- drizzle-orm 0.45.2
- sharp 0.35.0

### MIT

- react 19.0.0
- zod 4.6.5, 4.1.0
`;

describe('about info (F-SET-11)', () => {
  it('reports the running build facts and a verbatim build line', () => {
    const info = aboutInfo();
    expect(info.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(info.node).toBe(process.version.replace(/^v/, ''));
    expect(info.license).toBe(LICENSE_SUMMARY);
    expect(info.license_url).toBe('/api/about/license');
    expect(info.build_line).toContain(`Server build ${info.version}`);
    expect(info.build_line).toContain(`(${info.platform}-${info.arch})`);
    expect(info.build_line).toContain(`Node ${info.node}`);
    // F-61: the build-time pins, never "unknown".
    expect(info.build_line).toMatch(/· Next 16\.3\.\d+ ·/);
    expect(info.build_line).toMatch(/· PGlite 0\.5\.\d+ ·/);
    expect(info.build_line).not.toContain('unknown');
    expect(info.build_line).toContain('ffmpeg ');
    expect(info.no_telemetry).toContain('no telemetry');
  });

  it('parses production packages with their licences and lists each once', () => {
    const notices = parseThirdPartyNotices(NOTICES);
    const names = notices.map((n) => n.name);
    expect(names).toEqual(['drizzle-orm', 'react', 'sharp', 'zod']);
    expect(notices.find((n) => n.name === 'react')?.license).toBe('MIT');
    expect(notices.find((n) => n.name === 'drizzle-orm')?.license).toBe('Apache-2.0');
    // Only the first version is kept per package.
    expect(notices.find((n) => n.name === 'zod')?.version).toBe('4.6.5');
    // A dev-only tool is never in the generated file (generator uses --prod).
    expect(names).not.toContain('vitest');
  });

  it('returns an empty inventory when the notices file has no package headings', () => {
    expect(parseThirdPartyNotices('# Third-party notices\n')).toEqual([]);
  });
});

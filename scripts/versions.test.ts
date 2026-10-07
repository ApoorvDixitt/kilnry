// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildPins, GENERATED_PATH, renderGenerated } from './versions';

// F-61: the committed pins must be what the install resolved, so a dependency
// bump that forgets `pnpm gen:versions` fails here rather than shipping an
// About line with the old version.
describe('build-time version pins (F-61)', () => {
  it('the generated file matches the installed next and pglite', () => {
    expect(readFileSync(GENERATED_PATH, 'utf8')).toBe(renderGenerated(buildPins()));
  });

  it('reads real versions, including pglite, whose exports hide its package.json', () => {
    const pins = buildPins();
    expect(pins.next).toMatch(/^\d+\.\d+\.\d+/);
    expect(pins.pglite).toMatch(/^\d+\.\d+\.\d+/);
  });
});

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The design contract's banned patterns (03-design/01-design-contract.md:28)
// include "tracked-out uppercase labels". Ten rules in globals.css paired
// `text-transform: uppercase` with a positive `letter-spacing` (F-90), and the
// accessibility gate cannot see a typography rule, so this check reads every
// tracked stylesheet.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function stylesheets(): string[] {
  return execFileSync('git', ['ls-files', '*.css'], { encoding: 'utf8' }).split('\n').filter(Boolean);
}

export function trackedUppercaseRules(css: string): string[] {
  const found: string[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const body = match[2] ?? '';
    const uppercase = /text-transform\s*:\s*uppercase/i.test(body);
    const spacing = /letter-spacing\s*:\s*(\d*\.?\d+)/i.exec(body);
    if (uppercase && spacing && Number(spacing[1]) > 0)
      found.push((match[1] ?? '').trim().split('\n').at(-1)!.trim());
  }
  return found;
}

describe('design contract: no tracked-out uppercase labels (F-90)', () => {
  it('finds the pattern when it is there', () => {
    expect(trackedUppercaseRules('.a { text-transform: uppercase; letter-spacing: 0.04em; }')).toEqual([
      '.a',
    ]);
    expect(trackedUppercaseRules('.b { letter-spacing: -0.02em; }')).toEqual([]);
  });

  it('no tracked stylesheet pairs uppercase with positive letter-spacing', () => {
    const offenders = stylesheets().flatMap((file) =>
      trackedUppercaseRules(readFileSync(file, 'utf8')).map((selector) => `${file}: ${selector}`),
    );
    expect(offenders).toEqual([]);
  });
});

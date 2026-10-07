// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The design contract (03-design/01-design-contract.md §2–3) checked over every
// tracked stylesheet. Its banned patterns include "tracked-out uppercase
// labels". Ten rules in globals.css paired
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

// F-88: the @gate suite checks WCAG through axe and nothing in the design
// contract, so a rule like F-90's passed CI. These are the contract's rules a
// stylesheet can be read for. Accent-on-allowed-roles (rule 1) needs computed
// styles and is not checked here.
interface Rule {
  selector: string;
  body: string;
}

function rules(css: string): Rule[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: (match[1] ?? '').trim().split('\n').at(-1)!.trim(),
    body: match[2] ?? '',
  }));
}

// Rule 4: "weights 400 and 500 only, 600 for page titles".
export function badWeights(css: string): string[] {
  return rules(css)
    .filter((rule) =>
      [...rule.body.matchAll(/font-weight\s*:\s*(\d+)/g)].some((m) => !['400', '500', '600'].includes(m[1]!)),
    )
    .map((rule) => rule.selector);
}

// Rule 2: "Cards have no shadow" — a focus or hover ring drawn as a zero-blur
// spread (`0 0 0 2px`) is a ring, not a shadow.
export function cardShadows(css: string): string[] {
  return rules(css)
    .filter((rule) => /card/.test(rule.selector))
    .filter((rule) => {
      const value = /box-shadow\s*:\s*([^;]+)/.exec(rule.body)?.[1]?.trim();
      if (!value || value === 'none') return false;
      return !value.split(/,(?![^(]*\))/).every((part) => /^0\s+0\s+0\s+\d+(\.\d+)?px\s/.test(part.trim()));
    })
    .map((rule) => rule.selector);
}

// Banned: "Glassmorphism" (a backdrop blur) and "gradient washes on UI
// (gradients only on placeholder tiles)". The placeholder and media tiles that
// carry one are listed; a new gradient anywhere else fails.
const GRADIENT_TILES = new Set(['.character-thumb', '.character-detail-anchor', '.character-ref-label']);

export function glassAndGradients(css: string): string[] {
  return rules(css)
    .filter(
      (rule) =>
        /backdrop-filter\s*:\s*[^;]*blur/.test(rule.body) ||
        (/(linear|radial|conic)-gradient\(/.test(rule.body) && !GRADIENT_TILES.has(rule.selector)),
    )
    .map((rule) => rule.selector);
}

describe('design contract: weights, card shadows, glass and gradients (F-88)', () => {
  it('finds each pattern when it is there', () => {
    expect(badWeights('.a { font-weight: 700; } .b { font-weight: 500; }')).toEqual(['.a']);
    expect(
      cardShadows(
        '.x-card { box-shadow: 0 4px 12px rgba(0,0,0,.2); } .y-card:focus { box-shadow: 0 0 0 2px var(--ring); }',
      ),
    ).toEqual(['.x-card']);
    expect(
      glassAndGradients(
        '.sheet { backdrop-filter: blur(12px); } .hero { background: linear-gradient(red, blue); }',
      ),
    ).toEqual(['.sheet', '.hero']);
  });

  it('no tracked stylesheet breaks them', () => {
    const offenders = stylesheets().flatMap((file) => {
      const css = readFileSync(file, 'utf8');
      return [
        ...badWeights(css).map((selector) => `${file}: font-weight ${selector}`),
        ...cardShadows(css).map((selector) => `${file}: card shadow ${selector}`),
        ...glassAndGradients(css).map((selector) => `${file}: glass or gradient ${selector}`),
      ];
    });
    expect(offenders).toEqual([]);
  });
});

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import {
  ORIGINAL_PERSON_CLAUSE,
  assertAdult,
  castAlternatePrompts,
  castAnchorPrompt,
  castGenerationPrompts,
  type CastParams,
} from './cast.js';

const base: CastParams = {
  archetype: 'creator/host',
  age_range: '25-34',
  look: 'photoreal',
  region: 'South Asian',
  wardrobe: 'casual',
  vibe: 'warm and approachable',
};

describe('cast builder (F-CHR-15)', () => {
  it('always states the person is original and resembles no public figure', () => {
    expect(castAnchorPrompt(base)).toContain(ORIGINAL_PERSON_CLAUSE);
  });

  it('adds the realism module for a photoreal look', () => {
    expect(castAnchorPrompt(base)).toContain('visible skin pores');
    expect(castAnchorPrompt({ ...base, look: 'anime-2d' })).toContain('2D anime illustration');
  });

  it('keeps the setting hint out of the anchor and only in the third alternate', () => {
    const params: CastParams = { ...base, setting_hint: 'a rooftop at dusk' };
    expect(castAnchorPrompt(params)).not.toContain('rooftop');
    const alternates = castAlternatePrompts(params);
    expect(alternates).toHaveLength(3);
    expect(alternates[2]).toContain('rooftop at dusk');
  });

  it('produces one anchor and three alternates', () => {
    const { anchor, alternates } = castGenerationPrompts(base);
    expect(anchor).toContain('creator and on-camera host');
    expect(alternates).toHaveLength(3);
  });

  it('rejects a free-text age below eighteen', () => {
    expect(() => assertAdult('25-34', 'a 16 year old student')).toThrow(/minors/);
    expect(() => castAnchorPrompt({ ...base, region: 'a 15yo look' })).toThrow(/minors/);
  });

  it('accepts an adult free-text age', () => {
    expect(() => assertAdult('25-34', 'looks about 30')).not.toThrow();
  });
});

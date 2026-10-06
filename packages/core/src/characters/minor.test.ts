// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { MINOR_REFUSAL, minorSuspected } from './minor.js';

describe('minor_suspected (PRD-07 §7)', () => {
  it('carries the exact refusal copy', () => {
    expect(MINOR_REFUSAL).toBe('Kilnry does not train or clone minors.');
  });

  it('reads an age: tag under eighteen as a minor', () => {
    expect(minorSuspected({ tags: ['age:15'] })).toBe(true);
    expect(minorSuspected({ tags: ['Age: 17'] })).toBe(true);
    expect(minorSuspected({ tags: ['age:16-19'] })).toBe(true);
    expect(minorSuspected({ tags: ['age:teen'] })).toBe(true);
    expect(minorSuspected({ tags: ['age:18'] })).toBe(false);
    expect(minorSuspected({ tags: ['age:25-34'] })).toBe(false);
  });

  it('reads the descriptor words child, kid and teen as a minor', () => {
    for (const descriptor of [
      'a child in a raincoat',
      'two kids on bikes',
      'a teenager',
      'teenage drummer',
    ]) {
      expect(minorSuspected({ descriptor })).toBe(true);
    }
  });

  it('reads boy or girl as a minor only beside an age under eighteen', () => {
    expect(minorSuspected({ descriptor: 'a 12-year-old girl' })).toBe(true);
    expect(minorSuspected({ descriptor: 'a boy, aged 9' })).toBe(true);
    expect(minorSuspected({ descriptor: 'a 16yo boy' })).toBe(true);
    expect(minorSuspected({ descriptor: 'a girl in her 30s' })).toBe(false);
    expect(minorSuspected({ descriptor: 'a 40 year old man and his dog' })).toBe(false);
  });

  it('checks anchors too, and does not read years of experience as an age', () => {
    expect(minorSuspected({ descriptor: 'a dancer', anchors: ['15 years old'] })).toBe(true);
    expect(minorSuspected({ descriptor: 'a potter with 5 years of experience' })).toBe(false);
    expect(minorSuspected({})).toBe(false);
  });
});

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { CLONE_PROVIDERS, canClone, cloneLabel, providerOption, sampleLongEnough } from './clone-voice-logic';

describe('clone-voice logic (F-VOI-02)', () => {
  it('offers the three connected clone providers', () => {
    expect(CLONE_PROVIDERS.map((option) => option.provider)).toEqual(['minimax', 'elevenlabs', 'fal']);
    expect(providerOption('minimax').costUsd).toBe(1.5);
  });

  it('requires at least ten seconds', () => {
    expect(sampleLongEnough(9)).toBe(false);
    expect(sampleLongEnough(10)).toBe(true);
  });

  it('enables Clone only with a name, a long-enough sample and consent', () => {
    const base = {
      name: 'Riya',
      sampleSeconds: 30,
      sampleUrl: 'https://x/y.mp3',
      consent: true,
      cloning: false,
    };
    expect(canClone(base)).toBe(true);
    expect(canClone({ ...base, consent: false })).toBe(false);
    expect(canClone({ ...base, sampleSeconds: 5 })).toBe(false);
    expect(canClone({ ...base, name: '' })).toBe(false);
    expect(canClone({ ...base, sampleUrl: '' })).toBe(false);
    expect(canClone({ ...base, cloning: true })).toBe(false);
  });

  it('renders the price on the clone label', () => {
    expect(cloneLabel('Clone · {price}', '$1.50')).toBe('Clone · $1.50');
  });
});

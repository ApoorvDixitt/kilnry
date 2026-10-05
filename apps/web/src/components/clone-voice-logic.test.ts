// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { CLONE_PROVIDERS, canClone, cloneLabel, providerOption, sampleLongEnough } from './clone-voice-logic';

describe('clone-voice logic (F-VOI-02)', () => {
  it('offers the four clone options with the price each page publishes (PRD-08 §B2)', () => {
    expect(CLONE_PROVIDERS.map((option) => option.provider)).toEqual([
      'minimax',
      'elevenlabs',
      'kling',
      'fal',
    ]);
    expect(providerOption('minimax')).toMatchObject({
      costUsd: 1.5,
      priceLabel: '$1.50',
      minSeconds: 10,
      maxSeconds: 300,
    });
    // Kling's own voice creation through fal: $0.007, 5–30 s, for Kling speech.
    expect(providerOption('kling')).toMatchObject({
      costUsd: 0.007,
      priceLabel: '$0.007',
      minSeconds: 5,
      maxSeconds: 30,
    });
    // MiniMax's clone hosted on fal: $1.50, 10 s – 3 min, labelled as MiniMax.
    expect(providerOption('fal')).toMatchObject({
      costUsd: 1.5,
      priceLabel: '$1.50',
      minSeconds: 10,
      maxSeconds: 180,
      labelKey: 'characters.clone.providerFal',
    });
  });

  it('requires at least ten seconds, five for Kling', () => {
    expect(sampleLongEnough(9)).toBe(false);
    expect(sampleLongEnough(10)).toBe(true);
    expect(sampleLongEnough(5, 'kling')).toBe(true);
    expect(sampleLongEnough(4, 'kling')).toBe(false);
  });

  it('keeps a Kling sample inside 5–30 s', () => {
    const base = {
      name: 'Riya',
      sampleUrl: 'https://x/y.mp3',
      consent: true,
      cloning: false,
      provider: 'kling' as const,
    };
    expect(canClone({ ...base, sampleSeconds: 6 })).toBe(true);
    expect(canClone({ ...base, sampleSeconds: 31 })).toBe(false);
    expect(canClone({ ...base, sampleSeconds: 6, provider: 'fal' })).toBe(false);
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

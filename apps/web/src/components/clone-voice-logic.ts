// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The decisions the clone-voice drawer makes, kept out of the view so they can be
// tested on their own (F-VOI-02): which providers to offer, how long a sample
// must be, and whether the Clone button may be pressed.

export type CloneProvider = 'minimax' | 'elevenlabs' | 'fal';

export interface CloneProviderOption {
  provider: CloneProvider;
  labelKey: string;
  consentKey: string;
  costUsd: number;
  priceLabel: string;
  minSeconds: number;
  maxSeconds: number;
}

// The providers offered, their one-time price and their consent-text key
// (PRD-08 §B2). The consent sentence is shown verbatim from the catalogue.
export const CLONE_PROVIDERS: CloneProviderOption[] = [
  {
    provider: 'minimax',
    labelKey: 'characters.clone.providerMinimax',
    consentKey: 'characters.clone.consentMinimax',
    costUsd: 1.5,
    priceLabel: '$1.50',
    minSeconds: 10,
    maxSeconds: 300,
  },
  {
    provider: 'elevenlabs',
    labelKey: 'characters.clone.providerElevenlabs',
    consentKey: 'characters.clone.consentElevenlabs',
    costUsd: 0,
    priceLabel: '$0.00',
    minSeconds: 10,
    maxSeconds: 120,
  },
  {
    provider: 'fal',
    labelKey: 'characters.clone.providerFal',
    consentKey: 'characters.clone.consentFal',
    costUsd: 0,
    priceLabel: '—',
    minSeconds: 5,
    maxSeconds: 30,
  },
];

export const MIN_SAMPLE_SECONDS = 10;
export const MAX_SAMPLE_SECONDS = 180;

export function providerOption(provider: CloneProvider): CloneProviderOption {
  return CLONE_PROVIDERS.find((option) => option.provider === provider) ?? CLONE_PROVIDERS[0]!;
}

// Whether the sample is long enough overall (PRD-08 §B2: at least 10 seconds).
export function sampleLongEnough(seconds: number): boolean {
  return seconds >= MIN_SAMPLE_SECONDS;
}

// Whether the Clone button may be pressed: a sample long enough, a name, consent
// ticked, and no clone already running (PRD-08 §B2 acceptance 1).
export function canClone(input: {
  name: string;
  sampleSeconds: number;
  sampleUrl: string;
  consent: boolean;
  cloning: boolean;
}): boolean {
  if (input.cloning) return false;
  if (input.name.trim() === '' || input.sampleUrl.trim() === '') return false;
  if (!input.consent) return false;
  return sampleLongEnough(input.sampleSeconds);
}

// The clone button label, e.g. "Clone · $1.50".
export function cloneLabel(template: string, priceLabel: string): string {
  return template.replace('{price}', priceLabel);
}

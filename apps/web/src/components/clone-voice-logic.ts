// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The decisions the clone-voice drawer makes, kept out of the view so they can be
// tested on their own (F-VOI-02): which providers to offer, how long a sample
// must be, and whether the Clone button may be pressed.

// 'kling' is Kling's own voice creation reached through fal, the only voice kind
// Kling 3.0 speech accepts; 'fal' is MiniMax's clone hosted on fal (PRD-08 §B2).
export type CloneProvider = 'minimax' | 'elevenlabs' | 'kling' | 'fal';

export interface CloneProviderOption {
  provider: CloneProvider;
  labelKey: string;
  consentKey: string;
  // Whether the consent sentence is a summary of the provider's policy rather
  // than a reproducible verbatim line (PRD-08 §B2). When true the drawer labels
  // it "(provider policy, summarised)" and links to the provider page.
  summarised: boolean;
  sourceKey: string;
  costUsd: number;
  priceLabel: string;
  minSeconds: number;
  maxSeconds: number;
}

// The providers offered, their one-time price and their consent-text key
// (PRD-08 §B2). Every offered provider's sentence is a summary of its policy,
// so each is labelled "(provider policy, summarised)" with a link to its page;
// only Higgsfield's reference line (no V1 endpoint) is verbatim.
export const CLONE_PROVIDERS: CloneProviderOption[] = [
  {
    provider: 'minimax',
    labelKey: 'characters.clone.providerMinimax',
    consentKey: 'characters.clone.consentMinimax',
    summarised: true,
    sourceKey: 'characters.clone.sourceMinimax',
    costUsd: 1.5,
    priceLabel: '$1.50',
    minSeconds: 10,
    maxSeconds: 300,
  },
  {
    provider: 'elevenlabs',
    labelKey: 'characters.clone.providerElevenlabs',
    consentKey: 'characters.clone.consentElevenlabs',
    summarised: true,
    sourceKey: 'characters.clone.sourceElevenlabs',
    costUsd: 0,
    priceLabel: '$0.00',
    minSeconds: 10,
    maxSeconds: 120,
  },
  {
    // fal.ai/models/fal-ai/kling-video/create-voice: $0.007 per generation,
    // 5–30 s of one clean voice (read 2026-10-05).
    provider: 'kling',
    labelKey: 'characters.clone.providerKling',
    consentKey: 'characters.clone.consentFal',
    summarised: true,
    sourceKey: 'characters.clone.sourceKling',
    costUsd: 0.007,
    priceLabel: '$0.007',
    minSeconds: 5,
    maxSeconds: 30,
  },
  {
    // fal.ai/models/fal-ai/minimax/voice-clone: $1.50 per clone, 10 s–3 min.
    provider: 'fal',
    labelKey: 'characters.clone.providerFal',
    consentKey: 'characters.clone.consentFal',
    summarised: true,
    sourceKey: 'characters.clone.sourceFal',
    costUsd: 1.5,
    priceLabel: '$1.50',
    minSeconds: 10,
    maxSeconds: 180,
  },
];

export const MIN_SAMPLE_SECONDS = 10;
export const MAX_SAMPLE_SECONDS = 180;

export function providerOption(provider: CloneProvider): CloneProviderOption {
  return CLONE_PROVIDERS.find((option) => option.provider === provider) ?? CLONE_PROVIDERS[0]!;
}

// Whether the sample is long enough for the chosen option (PRD-08 §B2: 10 s for
// MiniMax and ElevenLabs, 5 s for Kling).
export function sampleLongEnough(seconds: number, provider: CloneProvider = 'minimax'): boolean {
  return seconds >= providerOption(provider).minSeconds;
}

// Whether the Clone button may be pressed: a sample long enough, a name, consent
// ticked, and no clone already running (PRD-08 §B2 acceptance 1).
export function canClone(input: {
  name: string;
  sampleSeconds: number;
  sampleUrl: string;
  consent: boolean;
  cloning: boolean;
  provider?: CloneProvider;
}): boolean {
  if (input.cloning) return false;
  if (input.name.trim() === '' || input.sampleUrl.trim() === '') return false;
  if (!input.consent) return false;
  const option = providerOption(input.provider ?? 'minimax');
  return sampleLongEnough(input.sampleSeconds, option.provider) && input.sampleSeconds <= option.maxSeconds;
}

/**
 * Which key pays for each option: a Kling voice and the MiniMax clone hosted on
 * fal are fal's, the other two are the provider's own (PRD-08 §B2).
 */
export const CLONE_PAYING_PROVIDER: Record<CloneProvider, string> = {
  minimax: 'minimax',
  elevenlabs: 'elevenlabs',
  kling: 'fal',
  fal: 'fal',
};

/**
 * PRD-08:231 offers "only connected" providers. All four were listed whatever
 * the user had, so MiniMax direct and ElevenLabs were offered with no key and
 * failed at submit (F-118).
 */
export function connectedCloneProviders(connected: string[]): CloneProviderOption[] {
  const have = new Set(connected);
  return CLONE_PROVIDERS.filter((option) => have.has(CLONE_PAYING_PROVIDER[option.provider]));
}

/**
 * Whether a recording on the user's disk can be used with this option: the
 * provider must have an upload Kilnry can drive (fal's storage today), so the
 * two direct endpoints still take a URL.
 */
export function acceptsUploadedSample(provider: CloneProvider): boolean {
  return CLONE_PAYING_PROVIDER[provider] === 'fal';
}

// The clone button label, e.g. "Clone · $1.50".
export function cloneLabel(template: string, priceLabel: string): string {
  return template.replace('{price}', priceLabel);
}

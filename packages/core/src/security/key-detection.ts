// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import type { ProviderId } from '../types.js';

export interface KeyCandidate {
  provider: ProviderId;
  confidence: 'high' | 'ambiguous';
}

const patterns: Array<{ provider: ProviderId; pattern: RegExp; confidence: KeyCandidate['confidence'] }> = [
  { provider: 'openrouter', pattern: /^sk-or-v1-[0-9a-f]{64}$/i, confidence: 'high' },
  {
    provider: 'fal',
    pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{32}$/i,
    confidence: 'high',
  },
  {
    provider: 'openai',
    pattern: /^sk-(?!or-|ant-)(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}$/,
    confidence: 'high',
  },
  { provider: 'google', pattern: /^AIza[0-9A-Za-z_-]{35}$/, confidence: 'high' },
  { provider: 'replicate', pattern: /^r8_[A-Za-z0-9]{37,40}$/, confidence: 'high' },
  { provider: 'minimax', pattern: /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, confidence: 'high' },
  { provider: 'higgsfield', pattern: /^[0-9a-f-]{36}:[A-Za-z0-9_-]{20,}$/i, confidence: 'ambiguous' },
  { provider: 'elevenlabs', pattern: /^sk_[0-9a-f]{48}$/i, confidence: 'ambiguous' },
  { provider: 'pollinations', pattern: /^sk_[A-Za-z0-9]{24,64}$/, confidence: 'ambiguous' },
  { provider: 'kie', pattern: /^[0-9a-f]{32}$/i, confidence: 'ambiguous' },
  { provider: 'wavespeed', pattern: /^[0-9a-f]{32,64}$/i, confidence: 'ambiguous' },
];

export function detectProviderKey(key: string): KeyCandidate[] {
  const candidates = patterns
    .filter((candidate) => candidate.pattern.test(key.trim()))
    .map(({ provider, confidence }) => ({ provider, confidence }));
  const highConfidence = candidates.filter((candidate) => candidate.confidence === 'high');
  return highConfidence.length > 0 ? highConfidence : candidates;
}

export function maskProviderKey(key: string): string {
  const value = key.trim();
  if (value.includes(':')) {
    return value
      .split(':')
      .map((part) => (part.length > 9 ? `${part.slice(0, 5)}••••${part.slice(-4)}` : '••••'))
      .join(':');
  }
  return value.length > 9 ? `${value.slice(0, 5)}••••${value.slice(-4)}` : '••••';
}

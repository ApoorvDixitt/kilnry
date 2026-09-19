// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { detectProviderKey, maskProviderKey } from './key-detection.js';

describe('key prefix detection', () => {
  it('detects unique fal and OpenRouter shapes', () => {
    const fal = `${'a'.repeat(8)}-${'b'.repeat(4)}-${'c'.repeat(4)}-${'d'.repeat(4)}-${'e'.repeat(12)}:${'f'.repeat(32)}`;
    const openrouter = ['sk-or-v1-', '0'.repeat(64)].join('');
    expect(detectProviderKey(fal)).toEqual([{ provider: 'fal', confidence: 'high' }]);
    expect(detectProviderKey(openrouter)).toEqual([{ provider: 'openrouter', confidence: 'high' }]);
  });

  it('keeps Pollinations and ElevenLabs ambiguous for sk_ keys', () => {
    const ambiguous = ['sk_', 'a'.repeat(48)].join('');
    expect(detectProviderKey(ambiguous).map((candidate) => candidate.provider)).toEqual([
      'elevenlabs',
      'pollinations',
    ]);
    expect(maskProviderKey(ambiguous)).not.toContain(ambiguous.slice(5, -4));
  });
});

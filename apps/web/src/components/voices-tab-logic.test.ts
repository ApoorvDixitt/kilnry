// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { filterVoiceRows, type VoiceRow } from './voices-tab-logic';

const row = (over: Partial<VoiceRow>): VoiceRow => ({
  provider: 'elevenlabs',
  voice_id: 'rachel',
  name: 'Rachel',
  language: 'en-US',
  gender: 'female',
  tags: [],
  is_clone: false,
  price_label: '$0.10 / 1k chars',
  ...over,
});

describe('filterVoiceRows', () => {
  it('filters by provider and language prefix', () => {
    const rows = [
      row({}),
      row({ provider: 'openai', voice_id: 'nova', language: 'en-US' }),
      row({ provider: 'minimax', voice_id: 'moss', language: 'zh-CN' }),
    ];
    expect(filterVoiceRows(rows, 'openai', '').map((r) => r.voice_id)).toEqual(['nova']);
    expect(filterVoiceRows(rows, '', 'zh').map((r) => r.voice_id)).toEqual(['moss']);
    expect(filterVoiceRows(rows, '', '')).toHaveLength(3);
  });
});

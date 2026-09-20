// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import {
  acceptMention,
  activeMentionQuery,
  distinctPeople,
  type ResolvePreview,
} from './composer-mentions-logic';

describe('activeMentionQuery', () => {
  it('detects a mention token at the caret', () => {
    expect(activeMentionQuery('hello @ma', 9)).toEqual({ query: 'ma', start: 6 });
    expect(activeMentionQuery('@maya', 5)).toEqual({ query: 'maya', start: 0 });
    expect(activeMentionQuery('just @', 6)).toEqual({ query: '', start: 5 });
  });

  it('returns nothing when the caret is not in a mention', () => {
    expect(activeMentionQuery('hello world', 11)).toBeUndefined();
    expect(activeMentionQuery('email me at maya@x', 18)).toBeUndefined();
  });
});

describe('acceptMention', () => {
  it('replaces the typed fragment with the handle and a trailing space', () => {
    const result = acceptMention('a shot of @ma', 13, 10, 'maya');
    expect(result.text).toBe('a shot of @maya ');
    expect(result.caret).toBe(16);
  });
});

describe('distinctPeople', () => {
  const preview = (handles: string[]): ResolvePreview => ({
    rewritten_prompt: '',
    warnings: [],
    injections: handles.map((handle) => ({
      handle,
      version: 1,
      strategy: 'reference_images',
      inputs: [],
      notes: [],
    })),
  });

  it('counts distinct character mentions and ignores a voice injection', () => {
    expect(distinctPeople(preview(['maya', 'rohan']))).toBe(2);
    expect(distinctPeople(preview(['maya', 'maya', 'rohan', 'priya']))).toBe(3);
    expect(distinctPeople(undefined)).toBe(0);
    const withVoice: ResolvePreview = {
      rewritten_prompt: '',
      warnings: [],
      injections: [
        { handle: 'maya', version: 1, strategy: 'reference_images', inputs: [], notes: [] },
        { handle: 'maya', version: 1, strategy: 'voice_id', inputs: [], notes: [] },
      ],
    };
    expect(distinctPeople(withVoice)).toBe(1);
  });
});

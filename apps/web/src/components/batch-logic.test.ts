// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { batchRequests, editKindFor, parseBatch } from './batch-logic';

describe('parseBatch', () => {
  it('parses one prompt per line and ignores blanks', () => {
    const parsed = parseBatch('a red bird\n\na blue fish\n');
    expect(parsed.error).toBeUndefined();
    expect(parsed.lines.map((l) => l.prompt)).toEqual(['a red bird', 'a blue fish']);
    expect(parsed.lines.map((l) => l.index)).toEqual([0, 1]);
  });

  it('reads a per-line override block', () => {
    const parsed = parseBatch('a poster {aspect: "1:1", count: 2, audio: true}');
    expect(parsed.lines[0]!.prompt).toBe('a poster');
    expect(parsed.lines[0]!.overrides).toEqual({ aspect: '1:1', count: 2, audio: true });
  });

  it('rejects a thirteenth prompt with the exact copy', () => {
    const parsed = parseBatch(Array.from({ length: 13 }, (_, i) => `prompt ${i}`).join('\n'));
    expect(parsed.error).toBe('Batch is limited to 12 prompts.');
    expect(parsed.lines).toHaveLength(0);
  });
});

describe('batchRequests', () => {
  it('maps lines to requests preserving the index order', () => {
    const parsed = parseBatch('one\ntwo\nthree');
    const requests = batchRequests(parsed, { kind: 'image', model: 'auto' });
    expect(requests.map((r) => r.index)).toEqual([0, 1, 2]);
    expect(requests.map((r) => r.prompt)).toEqual(['one', 'two', 'three']);
    expect(requests.every((r) => r.model === 'auto' && r.kind === 'image')).toBe(true);
  });
});

describe('editKindFor', () => {
  it('routes image edits and video edits, never text2image', () => {
    expect(editKindFor('image')).toBe('image_edit');
    expect(editKindFor('video')).toBe('video_edit');
  });
});

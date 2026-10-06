// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// F-26: the resolver's recursive merges assemble provider payload fragments from
// stored Character, Element and voice data, which is importable and shareable.
// A fragment carrying an own `__proto__` key merged straight into
// Object.prototype, which is the class the workflows templater already blocks
// (template.ts BANNED_KEYS).

import { describe, expect, it } from 'vitest';
import { deepMerge } from '../characters/resolve.js';
import { mergeFragment } from './resolve-step.js';

describe('fragment merging (F-CHR-09)', () => {
  it("the resolver's own merge never reaches Object.prototype", () => {
    // The finding's proof: deepMerge({}, JSON.parse('{"__proto__":{"polluted":"yes"}}'))
    // used to set ({}).polluted.
    const target: Record<string, unknown> = {};
    deepMerge(target, JSON.parse('{"__proto__":{"polluted":"yes"}}') as Record<string, unknown>);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('polluted');
    expect(Object.keys(target)).toEqual([]);
  });

  it('never follows __proto__, constructor or prototype', () => {
    const polluted = JSON.parse('{"__proto__":{"polluted":"yes"}}') as Record<string, unknown>;
    const merged = mergeFragment({}, polluted);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('polluted');
    expect(Object.keys(merged)).toEqual([]);

    const nested = JSON.parse('{"constructor":{"prototype":{"x":1}},"prototype":{"y":2}}') as Record<
      string,
      unknown
    >;
    mergeFragment({}, nested);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    expect(({} as Record<string, unknown>).y).toBeUndefined();
  });

  it('still merges the fields a fragment is for', () => {
    const merged = mergeFragment(
      { elements: [{ frontal_image_url: 'a' }] },
      { elements: [{ frontal_image_url: 'b' }], voice_ids: ['kv_1'] },
    );
    expect(merged).toEqual({
      elements: [{ frontal_image_url: 'a' }, { frontal_image_url: 'b' }],
      voice_ids: ['kv_1'],
    });
  });
});

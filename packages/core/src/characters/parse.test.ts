// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import type { CharacterHead } from './store.js';
import { parseMentions } from './parse.js';

function head(id: string, handle: string, version = 1): CharacterHead {
  return {
    id,
    handle,
    kind: 'character',
    display_name: handle,
    current_version: version,
    is_real_person: false,
    consent_status: 'n/a',
  };
}

const maya = head('01JAK7MAYA0000000000000000', 'maya', 2);
const rohan = head('01JAK7ROHAN000000000000000', 'rohan');
const chai = head('01JAK7CHAI0000000000000000', 'chai_glass');
const table: Record<string, CharacterHead> = {
  maya: maya,
  rohan: rohan,
  chai_glass: chai,
  [maya.id]: maya,
};
const lookup = (h: string): CharacterHead | undefined => table[h.toLowerCase()];

describe('parseMentions', () => {
  it('parses a single @handle to its character', () => {
    const { mentions, warnings } = parseMentions('@maya laughing at a chai stall', lookup);
    expect(warnings).toEqual([]);
    expect(mentions).toHaveLength(1);
    expect(mentions[0]).toMatchObject({ handle: 'maya', id: maya.id });
  });

  it('keeps first-appearance order and one mention per distinct id', () => {
    const { mentions } = parseMentions('@rohan meets @maya, then @maya waves at @rohan', lookup);
    expect(mentions.map((m) => m.handle)).toEqual(['rohan', 'maya']);
    expect(mentions[1]!.spans).toHaveLength(2);
  });

  it('pins a version with @handle@vN', () => {
    const { mentions } = parseMentions('put @maya@v1 in the jacket', lookup);
    expect(mentions[0]).toMatchObject({ handle: 'maya', version: 1 });
  });

  it('does not treat an email address as a mention', () => {
    const { mentions, warnings } = parseMentions('email me at maya@example.com please', lookup);
    expect(mentions).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('warns on an unknown handle and suggests the closest known one', () => {
    const { mentions, warnings } = parseMentions('@mya at the stall', lookup, ['maya', 'rohan']);
    expect(mentions).toEqual([]);
    expect(warnings[0]).toBe('@mya is not a Character; did you mean @maya?');
  });

  it('parses an internal <<<ulid>>> token', () => {
    const { mentions } = parseMentions(`hold <<<${maya.id}>>> steady`, lookup);
    expect(mentions[0]).toMatchObject({ id: maya.id });
  });

  it('parses multiple distinct handles in order', () => {
    const { mentions } = parseMentions('@maya hands @chai_glass to @rohan', lookup);
    expect(mentions.map((m) => m.handle)).toEqual(['maya', 'chai_glass', 'rohan']);
  });
});

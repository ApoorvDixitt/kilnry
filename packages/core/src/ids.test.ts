// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { parseUlid, ulid } from './ids.js';

describe('ULID boundary', () => {
  it('accepts canonical IDs and rejects path-like input', () => {
    const value = ulid();
    expect(parseUlid(value)).toBe(value);
    expect(() => parseUlid('../../private')).toThrow(/invalid id/i);
    expect(() => parseUlid('01j00000000000000000000000')).toThrow(/invalid id/i);
  });
});

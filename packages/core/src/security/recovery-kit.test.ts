// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { decodeRecoveryKit, encodeRecoveryKit, formatRecoveryKit } from './recovery-kit.js';

describe('recovery kit', () => {
  it('round-trips a 32-byte KEK with a Bech32m checksum', () => {
    const key = Uint8Array.from({ length: 32 }, (_, index) => index);
    const encoded = encodeRecoveryKit(key);
    expect(encoded.startsWith('kilnry1')).toBe(true);
    expect(decodeRecoveryKit(formatRecoveryKit(encoded))).toEqual(key);
  });

  it('rejects a changed checksum', () => {
    const encoded = encodeRecoveryKit(new Uint8Array(32));
    const changed = `${encoded.slice(0, -1)}${encoded.endsWith('q') ? 'p' : 'q'}`;
    expect(() => decodeRecoveryKit(changed)).toThrow(/checksum/i);
  });
});

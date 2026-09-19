// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { redact, redactString } from './redact.js';

describe('redaction', () => {
  it('removes every seeded credential shape from nested data and URLs', () => {
    const values = [
      ['sk-or-v1-', 'a'.repeat(64)].join(''),
      ['sk-proj-', 'Z'.repeat(28)].join(''),
      ['r8_', 'R'.repeat(38)].join(''),
      ['AIza', 'G'.repeat(35)].join(''),
      [
        `${'a'.repeat(8)}-${'b'.repeat(4)}-${'c'.repeat(4)}-${'d'.repeat(4)}-${'e'.repeat(12)}`,
        'f'.repeat(32),
      ].join(':'),
      ['sk_', 'P'.repeat(30)].join(''),
      ['kmcp_', 'x'.repeat(60)].join(''),
      ['kilnry1', 'q'.repeat(60)].join(''),
    ];
    const output = JSON.stringify(
      redact({
        authorization: `Bearer ${values[0]}`,
        nested: { api_key: values[1], values },
        url: `https://example.test/file?token=${encodeURIComponent(values[2]!)}`,
      }),
    );
    for (const value of values) expect(output).not.toContain(value);
  });

  it('redacts shaped secrets embedded in log text', () => {
    const value = ['sk-or-v1-', 'b'.repeat(64)].join('');
    expect(redactString(`provider rejected ${value}`)).not.toContain(value);
  });
});

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { KilnryConfigSchema } from './schema.js';

describe('appearance configuration', () => {
  it('defaults to system theme, comfortable density, and system motion', () => {
    expect(KilnryConfigSchema.parse({ data_dir: '/tmp/kilnry' })).toMatchObject({
      theme: 'system',
      density: 'comfortable',
      reduced_motion: 'system',
    });
  });

  it('accepts the explicit compact and reduced choices', () => {
    expect(
      KilnryConfigSchema.parse({
        data_dir: '/tmp/kilnry',
        theme: 'dark',
        density: 'compact',
        reduced_motion: 'reduce',
      }),
    ).toMatchObject({ theme: 'dark', density: 'compact', reduced_motion: 'reduce' });
  });
});

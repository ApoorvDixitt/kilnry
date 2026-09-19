// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { ModelManifestSchema } from '../manifest.js';
import { registrySeed } from './index.js';

describe('canonical registry seed', () => {
  it('contains unique, complete fal and OpenRouter manifests', () => {
    const keys = registrySeed.map((model) => `${model.provider}:${model.model_id}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(registrySeed.filter((model) => model.provider === 'fal')).toHaveLength(71);
    expect(registrySeed.filter((model) => model.provider === 'openrouter')).toHaveLength(36);
    for (const model of registrySeed) {
      expect(() => ModelManifestSchema.parse(model)).not.toThrow();
      expect(model.params_schema).toMatchObject({
        type: 'object',
        properties: expect.any(Object),
        additionalProperties: false,
      });
      expect(
        Object.keys((model.params_schema.properties ?? {}) as Record<string, unknown>).length,
      ).toBeGreaterThan(0);
    }
  });

  it('keeps D-42 routes excluded', () => {
    expect(registrySeed.some((model) => /sora/i.test(model.model_id))).toBe(false);
    expect(registrySeed.some((model) => /gemini-2\.5-flash-image/i.test(model.model_id))).toBe(false);
    expect(
      registrySeed
        .filter((model) => model.provider === 'fal' && /seedance-2\.5/i.test(model.model_id))
        .every((model) => !model.enabled),
    ).toBe(true);
  });
});

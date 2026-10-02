// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { autoRotateDefault, framingDistance, supportsWebGL } from './glb-viewer-logic';

function fakeDocument(context: unknown): Pick<Document, 'createElement'> {
  return {
    createElement: (() => ({ getContext: () => context })) as unknown as Document['createElement'],
  };
}

describe('GLB viewer logic (F-CRE-15)', () => {
  it('turns auto-rotate off under reduced motion', () => {
    expect(autoRotateDefault(true)).toBe(false);
    expect(autoRotateDefault(false)).toBe(true);
  });

  it('detects WebGL and falls back when the context is missing or throws', () => {
    expect(supportsWebGL(fakeDocument({}))).toBe(true);
    expect(supportsWebGL(fakeDocument(null))).toBe(false);
    const throwing = {
      createElement: (() => ({
        getContext: () => {
          throw new Error('no GPU');
        },
      })) as unknown as Document['createElement'],
    };
    expect(supportsWebGL(throwing)).toBe(false);
  });

  it('frames the model with a margin and survives an empty bounding box', () => {
    const distance = framingDistance(1, 40);
    expect(distance).toBeGreaterThan(1 / Math.sin((20 * Math.PI) / 180));
    expect(framingDistance(0, 40)).toBe(distance);
    expect(framingDistance(Number.NaN, 40)).toBe(distance);
  });
});

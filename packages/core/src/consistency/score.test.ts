// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { ARCFACE_TEMPLATE, decodeScrfd, similarityTransform, warpToTemplate } from './face.js';
import {
  badgeFor,
  centroid,
  cosine,
  embeddingFromBytes,
  embeddingToBytes,
  faceCheckApplies,
  summarise,
} from '../index.js';

describe('consistency scoring (F-CHR-12)', () => {
  it('buckets scores at the PRD-07 §13 thresholds', () => {
    expect(badgeFor(0.45)).toBe('high');
    expect(badgeFor(0.449)).toBe('medium');
    expect(badgeFor(0.3)).toBe('medium');
    expect(badgeFor(0.299)).toBe('low');
  });

  it('summarises a video by its minimum frame and reports the mean', () => {
    expect(summarise([0.52, 0.38, 0.66])).toEqual({ min: 0.38, mean: 0.52, badge: 'medium' });
  });

  it('compares directions, averages references into a unit anchor, and round-trips stored bytes', () => {
    const a = Float32Array.from([1, 0, 0]);
    const b = Float32Array.from([2, 0, 0]);
    const c = Float32Array.from([0, 1, 0]);
    expect(cosine(a, b)).toBeCloseTo(1);
    expect(cosine(a, c)).toBeCloseTo(0);
    const anchor = centroid([a, c]);
    expect(Math.hypot(...anchor)).toBeCloseTo(1);
    expect(cosine(anchor, a)).toBeCloseTo(Math.SQRT1_2);
    expect([...embeddingFromBytes(embeddingToBytes(Float32Array.from([0.25, -1.5])))]).toEqual([0.25, -1.5]);
  });

  it('scores only human-face Characters', () => {
    expect(faceCheckApplies({ kind: 'character', tags: [], look: 'photoreal' })).toBe(true);
    expect(faceCheckApplies({ kind: 'character', tags: [], look: undefined })).toBe(true);
    expect(faceCheckApplies({ kind: 'character', tags: [], look: '3d-stylised' })).toBe(false);
    expect(faceCheckApplies({ kind: 'character', tags: ['creature'], look: 'photoreal' })).toBe(false);
    expect(faceCheckApplies({ kind: 'prop', tags: [], look: 'photoreal' })).toBe(false);
  });
});

describe('face alignment geometry (F-CHR-12)', () => {
  it('recovers a known rotation, scale and translation', () => {
    const angle = 0.3;
    const scale = 1.7;
    const moved = ARCFACE_TEMPLATE.map(([x, y]) => [
      scale * (Math.cos(angle) * x - Math.sin(angle) * y) + 10,
      scale * (Math.sin(angle) * x + Math.cos(angle) * y) - 4,
    ]) as Array<[number, number]>;
    const [a, b, tx, c, d, ty] = similarityTransform(ARCFACE_TEMPLATE, moved);
    expect(a).toBeCloseTo(scale * Math.cos(angle));
    expect(c).toBeCloseTo(scale * Math.sin(angle));
    expect(b).toBeCloseTo(-c);
    expect(d).toBeCloseTo(a);
    expect(tx).toBeCloseTo(10);
    expect(ty).toBeCloseTo(-4);
  });

  it('warps through the identity into normalised CHW values', () => {
    const rgb = new Uint8Array(112 * 112 * 3).fill(255);
    const out = warpToTemplate(rgb, 112, 112, [1, 0, 0, 0, 1, 0]);
    expect(out).toHaveLength(3 * 112 * 112);
    expect(out[0]).toBeCloseTo(1);
  });

  it('decodes an SCRFD anchor into a box and five landmarks in input pixels', () => {
    const cells = [640 / 8, 640 / 16, 640 / 32].map((size) => size * size * 2);
    const scores = cells.map((count) => new Float32Array(count));
    const boxes = cells.map((count) => new Float32Array(count * 4));
    const landmarks = cells.map((count) => new Float32Array(count * 10));
    // Stride 32, cell (x=2, y=1) → centre (64, 32); its first anchor is index 2 * (1*20 + 2).
    const index = 2 * (1 * 20 + 2);
    scores[2]![index] = 0.9;
    boxes[2]!.set([1, 1, 1, 1], index * 4);
    landmarks[2]!.set([0, 0, 1, 0, 0, 1, -1, 0, 0, -1], index * 10);
    const [best, ...rest] = decodeScrfd({ scores, boxes, landmarks });
    expect(rest).toHaveLength(0);
    expect(best?.box).toEqual([32, 0, 96, 64]);
    expect(best?.landmarks[1]).toEqual([96, 32]);
  });
});

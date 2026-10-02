// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Consistency check scoring (F-CHR-12, PRD-07 §13): cosine similarity between
// an output's face embedding and the Character's anchor, bucketed into a badge.
// Pure functions, unit-tested without the model.

export type ConsistencyBadge = 'high' | 'medium' | 'low';

// Default thresholds (PRD-07 §13): high ≥ 0.45, medium 0.30–0.45, low < 0.30.
export const CONSISTENCY_THRESHOLDS = { high: 0.45, medium: 0.3 } as const;

// What is stored on the asset (sidecar `consistency` and the index column). The
// embeddings themselves are never stored here, logged, or written to fixtures.
export interface ConsistencyScore {
  model: 'auraface-v1';
  character: string;
  version: number;
  badge: ConsistencyBadge;
  // The image score, or the minimum across sampled video frames.
  min: number;
  mean: number;
  frames: number;
  computed_at: string;
}

export function l2Normalise(vector: Float32Array): Float32Array {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const length = Math.sqrt(sum);
  if (length === 0 || !Number.isFinite(length)) return new Float32Array(vector.length);
  return vector.map((value) => value / length);
}

export function cosine(left: Float32Array, right: Float32Array): number {
  if (left.length !== right.length) throw new Error('Embeddings must have the same length.');
  const a = l2Normalise(left);
  const b = l2Normalise(right);
  let dot = 0;
  for (let index = 0; index < a.length; index += 1) dot += a[index]! * b[index]!;
  return dot;
}

// The anchor: the normalised mean of the reference embeddings.
export function centroid(embeddings: Float32Array[]): Float32Array {
  const first = embeddings[0];
  if (!first) throw new Error('A centroid needs at least one embedding.');
  const sum = new Float32Array(first.length);
  for (const embedding of embeddings) {
    const unit = l2Normalise(embedding);
    for (let index = 0; index < sum.length; index += 1) sum[index]! += unit[index]!;
  }
  return l2Normalise(sum);
}

export function badgeFor(score: number): ConsistencyBadge {
  if (score >= CONSISTENCY_THRESHOLDS.high) return 'high';
  if (score >= CONSISTENCY_THRESHOLDS.medium) return 'medium';
  return 'low';
}

// An image has one score; a video has one per sampled frame and its badge uses
// the minimum (PRD-07 §13).
export function summarise(scores: number[]): { min: number; mean: number; badge: ConsistencyBadge } {
  if (scores.length === 0) throw new Error('A consistency summary needs at least one score.');
  const min = Math.min(...scores);
  const mean = scores.reduce((total, value) => total + value, 0) / scores.length;
  return { min: round(min), mean: round(mean), badge: badgeFor(min) };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

// The bytes stored in character_references.face_embedding: little-endian float32.
export function embeddingToBytes(embedding: Float32Array): Uint8Array {
  const view = new DataView(new ArrayBuffer(embedding.length * 4));
  embedding.forEach((value, index) => view.setFloat32(index * 4, value, true));
  return new Uint8Array(view.buffer);
}

export function embeddingFromBytes(bytes: Uint8Array): Float32Array {
  if (bytes.byteLength % 4 !== 0) throw new Error('A stored face embedding must be whole float32 values.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Float32Array.from({ length: bytes.byteLength / 4 }, (_, index) => view.getFloat32(index * 4, true));
}

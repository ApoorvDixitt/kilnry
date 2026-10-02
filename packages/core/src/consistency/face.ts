// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The local face pipeline for the consistency check (F-CHR-12): find the face
// with SCRFD, align it to the ArcFace 112×112 template from its five landmarks,
// and embed it with AuraFace-v1. The ONNX runtime and both models are the files
// the owner downloaded on enable (install.ts); nothing here touches the network.
// The geometry is pure and unit-tested; the model itself never runs in CI.

import { createRequire } from 'node:module';
import { join } from 'node:path';
import sharp from 'sharp';
import { l2Normalise } from './score.js';

// Turns an image file into a face embedding, or null when no face is found.
export interface FaceEmbedder {
  embed(path: string): Promise<Float32Array | null>;
}

export interface Detection {
  score: number;
  box: [number, number, number, number];
  landmarks: Array<[number, number]>;
}

// The five ArcFace landmark positions in a 112×112 aligned crop.
export const ARCFACE_TEMPLATE: Array<[number, number]> = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];

const DETECTOR_SIZE = 640;
const STRIDES = [8, 16, 32] as const;
const ANCHORS_PER_CELL = 2;

// Decode SCRFD's per-stride outputs (scores, distance boxes, landmark offsets)
// into detections in input-pixel space, keeping those above the threshold.
export function decodeScrfd(
  outputs: { scores: Float32Array[]; boxes: Float32Array[]; landmarks: Float32Array[] },
  threshold = 0.5,
  inputSize = DETECTOR_SIZE,
): Detection[] {
  const detections: Detection[] = [];
  STRIDES.forEach((stride, level) => {
    const scores = outputs.scores[level]!;
    const boxes = outputs.boxes[level]!;
    const marks = outputs.landmarks[level]!;
    const cells = inputSize / stride;
    for (let index = 0; index < scores.length; index += 1) {
      const score = scores[index]!;
      if (score < threshold) continue;
      const cell = Math.floor(index / ANCHORS_PER_CELL);
      const cx = (cell % cells) * stride;
      const cy = Math.floor(cell / cells) * stride;
      const d = (offset: number): number => boxes[index * 4 + offset]! * stride;
      detections.push({
        score,
        box: [cx - d(0), cy - d(1), cx + d(2), cy + d(3)],
        landmarks: Array.from({ length: 5 }, (_, point) => [
          cx + marks[index * 10 + point * 2]! * stride,
          cy + marks[index * 10 + point * 2 + 1]! * stride,
        ]),
      });
    }
  });
  return detections.sort((left, right) => right.score - left.score);
}

// The least-squares similarity transform (rotation, uniform scale, translation)
// taking `from` onto `to` (Umeyama). Returns [a, b, tx, c, d, ty] for
// x' = a·x + b·y + tx, y' = c·x + d·y + ty.
export function similarityTransform(
  from: Array<[number, number]>,
  to: Array<[number, number]>,
): [number, number, number, number, number, number] {
  const n = from.length;
  const mean = (points: Array<[number, number]>): [number, number] => [
    points.reduce((s, p) => s + p[0], 0) / n,
    points.reduce((s, p) => s + p[1], 0) / n,
  ];
  const [fx, fy] = mean(from);
  const [tx, ty] = mean(to);
  let sxx = 0;
  let sxy = 0;
  let variance = 0;
  for (let index = 0; index < n; index += 1) {
    const ax = from[index]![0] - fx;
    const ay = from[index]![1] - fy;
    const bx = to[index]![0] - tx;
    const by = to[index]![1] - ty;
    sxx += ax * bx + ay * by;
    sxy += ax * by - ay * bx;
    variance += ax * ax + ay * ay;
  }
  if (variance === 0) throw new Error('Landmarks must not all coincide.');
  const a = sxx / variance;
  const b = sxy / variance;
  return [a, -b, tx - (a * fx - b * fy), b, a, ty - (b * fx + a * fy)];
}

// Sample a 112×112 RGB crop from an interleaved RGB image through the inverse of
// the alignment transform, bilinearly; outside the image is black.
export function warpToTemplate(
  rgb: Uint8Array,
  width: number,
  height: number,
  transform: [number, number, number, number, number, number],
  size = 112,
): Float32Array {
  const [a, b, tx, c, d, ty] = transform;
  const det = a * d - b * c;
  if (det === 0) throw new Error('The alignment transform is singular.');
  const ia = d / det;
  const ib = -b / det;
  const ic = -c / det;
  const id = a / det;
  // CHW float input normalised to [-1, 1] as AuraFace expects.
  const out = new Float32Array(3 * size * size);
  const pixel = (x: number, y: number, channel: number): number =>
    x < 0 || y < 0 || x >= width || y >= height ? 0 : rgb[(y * width + x) * 3 + channel]!;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sx = ia * (x - tx) + ib * (y - ty);
      const sy = ic * (x - tx) + id * (y - ty);
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      for (let channel = 0; channel < 3; channel += 1) {
        const value =
          pixel(x0, y0, channel) * (1 - fx) * (1 - fy) +
          pixel(x0 + 1, y0, channel) * fx * (1 - fy) +
          pixel(x0, y0 + 1, channel) * (1 - fx) * fy +
          pixel(x0 + 1, y0 + 1, channel) * fx * fy;
        out[channel * size * size + y * size + x] = (value - 127.5) / 127.5;
      }
    }
  }
  return out;
}

interface OrtTensor {
  data: Float32Array;
}
interface OrtSession {
  inputNames: readonly string[];
  outputNames: readonly string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensor>>;
}
interface OrtModule {
  InferenceSession: { create(path: string): Promise<OrtSession> };
  Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => unknown;
}

// The ONNX embedder over the downloaded runtime and models.
export class OnnxFaceEmbedder implements FaceEmbedder {
  readonly #runtime: string;
  readonly #detectorPath: string;
  readonly #recognizerPath: string;
  #ready?: Promise<{ ort: OrtModule; detector: OrtSession; recognizer: OrtSession }>;

  constructor(options: { runtimeDir: string; detectorPath: string; recognizerPath: string }) {
    this.#runtime = options.runtimeDir;
    this.#detectorPath = options.detectorPath;
    this.#recognizerPath = options.recognizerPath;
  }

  #load(): Promise<{ ort: OrtModule; detector: OrtSession; recognizer: OrtSession }> {
    this.#ready ??= (async () => {
      const ort = createRequire(join(this.#runtime, 'package.json'))(this.#runtime) as OrtModule;
      const [detector, recognizer] = await Promise.all([
        ort.InferenceSession.create(this.#detectorPath),
        ort.InferenceSession.create(this.#recognizerPath),
      ]);
      return { ort, detector, recognizer };
    })();
    return this.#ready;
  }

  async embed(path: string): Promise<Float32Array | null> {
    const { ort, detector, recognizer } = await this.#load();
    const { data: rgb, info } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    // Letterbox into the detector's square input, keeping the aspect ratio.
    const scale = Math.min(DETECTOR_SIZE / info.width, DETECTOR_SIZE / info.height);
    const width = Math.max(1, Math.round(info.width * scale));
    const height = Math.max(1, Math.round(info.height * scale));
    const resized = await sharp(rgb, { raw: { width: info.width, height: info.height, channels: 3 } })
      .resize(width, height)
      .raw()
      .toBuffer();
    const input = new Float32Array(3 * DETECTOR_SIZE * DETECTOR_SIZE);
    const plane = DETECTOR_SIZE * DETECTOR_SIZE;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        for (let channel = 0; channel < 3; channel += 1) {
          input[channel * plane + y * DETECTOR_SIZE + x] =
            (resized[(y * width + x) * 3 + channel]! - 127.5) / 128;
        }
      }
    }
    const found = await detector.run({
      [detector.inputNames[0]!]: new ort.Tensor('float32', input, [1, 3, DETECTOR_SIZE, DETECTOR_SIZE]),
    });
    // SCRFD emits scores, boxes and landmarks for strides 8, 16 and 32, in that order.
    const tensors = detector.outputNames.map((name) => found[name]!.data);
    const [best] = decodeScrfd({
      scores: tensors.slice(0, 3),
      boxes: tensors.slice(3, 6),
      landmarks: tensors.slice(6, 9),
    });
    if (!best) return null;
    const landmarks = best.landmarks.map(([x, y]) => [x / scale, y / scale] as [number, number]);
    const crop = warpToTemplate(
      new Uint8Array(rgb.buffer, rgb.byteOffset, rgb.byteLength),
      info.width,
      info.height,
      similarityTransform(landmarks, ARCFACE_TEMPLATE),
    );
    const embedded = await recognizer.run({
      [recognizer.inputNames[0]!]: new ort.Tensor('float32', crop, [1, 3, 112, 112]),
    });
    return l2Normalise(Float32Array.from(embedded[recognizer.outputNames[0]!]!.data));
  }
}

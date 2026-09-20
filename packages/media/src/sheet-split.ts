// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Cut a turnaround row sheet into its individual panels with sharp (free, local)
// for the reference-sheet pipeline (F-CHR-04). A row sheet is one wide image with
// N equal-width panels side by side; each panel is written as its own PNG so it
// can be registered as a separate reference file.

import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import sharp from 'sharp';

// The pixel geometry of one panel cut from a row sheet of the given width.
export function panelBox(
  sheetWidth: number,
  sheetHeight: number,
  panelCount: number,
  index: number,
): { left: number; top: number; width: number; height: number } {
  if (panelCount < 1) throw new Error('A sheet has at least one panel.');
  const panelWidth = Math.floor(sheetWidth / panelCount);
  const left = index * panelWidth;
  // The last panel takes any remainder so nothing is dropped.
  const width = index === panelCount - 1 ? sheetWidth - left : panelWidth;
  return { left, top: 0, width, height: sheetHeight };
}

// Cut `outputs.length` equal panels from the row sheet at `inputPath`, writing
// each to its path. Returns the paths written, in order.
export async function splitRowSheet(inputPath: string, outputs: string[]): Promise<string[]> {
  const panelCount = outputs.length;
  if (panelCount < 1) return [];
  const image = sharp(inputPath, { limitInputPixels: 268_435_456 });
  const meta = await image.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width === 0 || height === 0) throw new Error('The sheet image has no dimensions.');

  const written: string[] = [];
  for (let index = 0; index < panelCount; index += 1) {
    const out = outputs[index]!;
    await mkdir(dirname(out), { recursive: true, mode: 0o700 });
    const box = panelBox(width, height, panelCount, index);
    // A fresh sharp instance per panel so extract regions do not accumulate.
    await sharp(inputPath, { limitInputPixels: 268_435_456 }).extract(box).png().toFile(out);
    written.push(out);
  }
  return written;
}

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

/**
 * One cell of a `columns × rows` grid, row-major. TRD-12 §6.3 gives split_grid
 * both dimensions; only the single-row case was implemented, so a 3 × 3
 * expression sheet was cut into three tall strips (found while adding the
 * assemble-parameter validation, F-65).
 */
export function cellBox(
  sheetWidth: number,
  sheetHeight: number,
  columns: number,
  rows: number,
  index: number,
): { left: number; top: number; width: number; height: number } {
  if (columns < 1 || rows < 1) throw new Error('A grid has at least one column and one row.');
  const column = index % columns;
  const row = Math.floor(index / columns);
  const cellWidth = Math.floor(sheetWidth / columns);
  const cellHeight = Math.floor(sheetHeight / rows);
  const left = column * cellWidth;
  const top = row * cellHeight;
  return {
    left,
    top,
    // The last column and row take the remainder so nothing is dropped.
    width: column === columns - 1 ? sheetWidth - left : cellWidth,
    height: row === rows - 1 ? sheetHeight - top : cellHeight,
  };
}

export interface SplitGridOptions {
  columns?: number;
  rows?: number;
  /** Crop each cell to its content (§6.3 "content-bounds trim"). */
  trim?: boolean;
  /** Luminance distance from the backdrop that still counts as background. */
  trimThreshold?: number;
  /** Padding added back after the trim, as a percentage of the cell. */
  padPct?: number;
}

/**
 * Cut a sheet into `columns × rows` cells with §6.3's ladder: crop the cell,
 * trim it to its content, pad it back, write a PNG. `trim`, `trim_threshold`,
 * `pad_pct`, `rows`, `labels` and `tag_source` were all declared by the
 * character-sheet workflow and none of them reached this function (F-65).
 */
export async function splitGridSheet(
  inputPath: string,
  outputs: string[],
  options: SplitGridOptions = {},
): Promise<string[]> {
  const cells = outputs.length;
  if (cells < 1) return [];
  const columns = Math.max(1, options.columns ?? cells);
  const rows = Math.max(1, options.rows ?? Math.ceil(cells / columns));
  const meta = await sharp(inputPath, { limitInputPixels: 268_435_456 }).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width === 0 || height === 0) throw new Error('The sheet image has no dimensions.');

  const written: string[] = [];
  for (const [index, out] of outputs.entries()) {
    await mkdir(dirname(out), { recursive: true, mode: 0o700 });
    const box = cellBox(width, height, columns, rows, index);
    let pipeline = sharp(inputPath, { limitInputPixels: 268_435_456 }).extract(box);
    if (options.trim !== false) {
      pipeline = pipeline.trim({ threshold: Math.max(0, Math.min(64, options.trimThreshold ?? 12)) });
    }
    const padPct = Math.max(0, Math.min(10, options.padPct ?? 2));
    if (padPct > 0) {
      const pad = Math.round((Math.min(box.width, box.height) * padPct) / 100);
      if (pad > 0) {
        pipeline = pipeline.extend({
          top: pad,
          bottom: pad,
          left: pad,
          right: pad,
          background: { r: 255, g: 255, b: 255, alpha: 0 },
        });
      }
    }
    await pipeline.png().toFile(out);
    written.push(out);
  }
  return written;
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

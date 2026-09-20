// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { panelBox, splitRowSheet } from './sheet-split.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('panelBox', () => {
  it('divides a sheet into equal panels and gives the remainder to the last', () => {
    expect(panelBox(400, 100, 4, 0)).toEqual({ left: 0, top: 0, width: 100, height: 100 });
    expect(panelBox(400, 100, 4, 3)).toEqual({ left: 300, top: 0, width: 100, height: 100 });
    // 401 / 4 = 100 with a remainder of 1 → last panel is 101 wide.
    expect(panelBox(401, 100, 4, 3)).toEqual({ left: 300, top: 0, width: 101, height: 100 });
  });

  it('rejects a sheet with no panels', () => {
    expect(() => panelBox(400, 100, 0, 0)).toThrow();
  });
});

describe('splitRowSheet', () => {
  it('cuts a wide sheet into the requested number of panel files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kilnry-split-'));
    roots.push(root);
    const sheet = join(root, 'sheet.png');
    // A 400×100 sheet of four coloured 100-wide bands.
    await sharp({
      create: { width: 400, height: 100, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .png()
      .toFile(sheet);

    const outputs = [0, 1, 2, 3].map((index) => join(root, `panel_${index}.png`));
    const written = await splitRowSheet(sheet, outputs);
    expect(written).toEqual(outputs);
    for (const out of outputs) {
      const meta = await sharp(out).metadata();
      expect(meta.width).toBe(100);
      expect(meta.height).toBe(100);
    }
  });

  it('returns nothing for an empty output list', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kilnry-split-'));
    roots.push(root);
    const sheet = join(root, 'sheet.png');
    await sharp({ create: { width: 100, height: 100, channels: 3, background: '#000' } })
      .png()
      .toFile(sheet);
    expect(await splitRowSheet(sheet, [])).toEqual([]);
  });
});

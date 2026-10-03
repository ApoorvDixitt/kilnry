// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { escapeXml, headlineSvg, overlayText, wrapHeadline } from './overlay-text.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('overlay_text (F-WFL-06, TRD-09 §2 "no drawtext")', () => {
  it('escapes the five XML characters so user text is never markup', () => {
    expect(escapeXml(`<b>a & "b" 'c'</b>`)).toBe('&lt;b&gt;a &amp; &quot;b&quot; &apos;c&apos;&lt;/b&gt;');
  });

  it('wraps a headline into lines by words', () => {
    expect(wrapHeadline('one two three four five', 9)).toEqual(['one two', 'three', 'four five']);
    expect(wrapHeadline('   ', 10)).toEqual(['']);
  });

  it('builds an SVG with the escaped text, chosen weight and a stroke by default', () => {
    const svg = headlineSvg(1280, 720, { text: 'Sale & Save', font: 'Montserrat 800', position: 'bottom' });
    expect(svg).toContain('Sale &amp; Save');
    expect(svg).toContain('font-weight="800"');
    expect(svg).toContain('stroke="#000000"');
    expect(svg).not.toContain('drawtext');
  });

  it('composites the headline onto an image and writes a readable PNG', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kilnry-overlay-text-'));
    roots.push(root);
    const base = join(root, 'base.png');
    await sharp({ create: { width: 640, height: 360, channels: 3, background: '#223344' } })
      .png()
      .toFile(base);
    const out = join(root, 'headline.png');
    await overlayText(base, out, { text: 'Hello World', font: 'Montserrat 800', position: 'top' });
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(640);
    expect(meta.height).toBe(360);
  });
});

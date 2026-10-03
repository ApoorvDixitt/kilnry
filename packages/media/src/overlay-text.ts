// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// overlay_text draws a headline onto an image for the thumbnail workflow. User
// text never enters an ffmpeg filtergraph (TRD-09 §2 allow-list, "no drawtext"),
// so the text is rendered as an SVG layer and composited with sharp. The SVG is
// built from escaped text and Kilnry's own layout, never raw user markup.

import sharp from 'sharp';

export interface OverlayTextParams {
  text: string;
  position?: string;
  stroke?: boolean;
  // A font family hint such as "Montserrat 800"; only the family name is used,
  // the weight maps to the SVG font-weight.
  font?: string;
  color?: string;
  safe_zone?: string;
}

// Escape the five XML characters so user text is data, never markup.
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Wrap a headline to a line length that fits the width, by words.
export function wrapHeadline(text: string, maxChars: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line === '' ? word : `${line} ${word}`;
    if (candidate.length > maxChars && line !== '') {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line !== '') lines.push(line);
  return lines.length > 0 ? lines : [''];
}

interface Anchor {
  x: number;
  y: number;
  textAnchor: 'start' | 'middle' | 'end';
}

// Where the text block sits for a position, inside a safe-zone inset.
function anchorFor(position: string, width: number, height: number): Anchor {
  const insetX = Math.round(width * 0.08);
  const top = Math.round(height * 0.16);
  const bottom = Math.round(height * 0.84);
  const middleX = Math.round(width / 2);
  const middleY = Math.round(height / 2);
  switch (position) {
    case 'top':
      return { x: middleX, y: top, textAnchor: 'middle' };
    case 'left':
      return { x: insetX, y: middleY, textAnchor: 'start' };
    case 'right':
      return { x: width - insetX, y: middleY, textAnchor: 'end' };
    case 'bottom':
      return { x: middleX, y: bottom, textAnchor: 'middle' };
    case 'center':
      return { x: middleX, y: middleY, textAnchor: 'middle' };
    default:
      return { x: middleX, y: bottom, textAnchor: 'middle' };
  }
}

export function headlineSvg(width: number, height: number, params: OverlayTextParams): string {
  const short = Math.min(width, height);
  const fontSize = Math.round(short * 0.08);
  const lineHeight = Math.round(fontSize * 1.15);
  const family = (params.font ?? 'Montserrat').split(/\s+/)[0] || 'Montserrat';
  const weight = /[89]00|bold|extra/i.test(params.font ?? '') ? 800 : 600;
  const fill = params.color && /^#[0-9a-fA-F]{6}$/.test(params.color) ? params.color : '#FFFFFF';
  const anchor = anchorFor(params.position ?? 'bottom', width, height);
  const lines = wrapHeadline(params.text, Math.max(8, Math.round(width / (fontSize * 0.6))));
  const strokeAttrs =
    params.stroke === false
      ? ''
      : ` stroke="#000000" stroke-width="${Math.round(fontSize * 0.08)}" paint-order="stroke"`;
  const first = anchor.y - (lines.length - 1) * lineHeight;
  const tspans = lines
    .map(
      (line, index) => `<tspan x="${anchor.x}" y="${first + index * lineHeight}">${escapeXml(line)}</tspan>`,
    )
    .join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<text font-family="${escapeXml(family)}, sans-serif" font-weight="${weight}" font-size="${fontSize}" ` +
    `fill="${fill}"${strokeAttrs} text-anchor="${anchor.textAnchor}">${tspans}</text></svg>`
  );
}

// Composite the headline onto the base image and write a PNG.
export async function overlayText(input: string, output: string, params: OverlayTextParams): Promise<void> {
  const image = sharp(input, { limitInputPixels: 268_435_456 }).rotate();
  const meta = await image.metadata();
  const width = meta.width ?? 1280;
  const height = meta.height ?? 720;
  const svg = headlineSvg(width, height, params);
  await image
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png({ compressionLevel: 9 })
    .toFile(output);
}

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Build the Advanced SubStation Alpha (ASS) subtitle file libass burns in
// (TRD-09 §4). Kilnry's own looks (D-16); the `clean` look (Inter SemiBold) is
// what the catalogue uses. Pure string building, unit-tested; the font ships
// under packages/media/assets/fonts and is found through fontsdir at burn time.

import type { Cue } from './transcript.js';

export type CaptionLook = 'clean' | 'paper' | 'bold';
export type SafeZone = 'auto' | 'reels' | 'landscape' | 'none';

export interface AssOptions {
  width: number;
  height: number;
  look?: CaptionLook;
  safeZone?: SafeZone;
}

// hh:mm:ss.cs in ASS centiseconds.
export function assTime(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = Math.floor(clamped % 60);
  const cs = Math.round((clamped - Math.floor(clamped)) * 100);
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0');
  return `${h}:${pad(m)}:${pad(s)}.${pad(cs)}`;
}

// Escape the characters ASS event text treats specially so caption text is data,
// not markup: braces open override blocks and a backslash starts a tag.
export function escapeAssText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/\r?\n/g, '\\N');
}

interface Style {
  fontName: string;
  fontSize: number;
  primary: string;
  outline: string;
  outlineWidth: number;
  borderStyle: number;
  shadow: number;
}

function styleFor(look: CaptionLook, short: number): Style {
  if (look === 'bold') {
    return {
      fontName: 'Metropolis',
      fontSize: Math.round(short * 0.058),
      primary: '&H00FFFFFF',
      outline: '&H00000000',
      outlineWidth: Math.max(1, Math.round(short * 0.006)),
      borderStyle: 1,
      shadow: 1,
    };
  }
  if (look === 'paper') {
    return {
      fontName: 'Montserrat',
      fontSize: Math.round(short * 0.046),
      primary: '&H001B1F1B',
      outline: '&H00D2E7F1',
      outlineWidth: 6,
      borderStyle: 3,
      shadow: 2,
    };
  }
  // clean (default): Inter SemiBold, small and unobtrusive.
  return {
    fontName: 'Inter',
    fontSize: Math.round(short * 0.042),
    primary: '&H00FFFFFF',
    outline: '&HA0000000',
    outlineWidth: 2,
    borderStyle: 1,
    shadow: 0,
  };
}

// Bottom and side margins per safe zone (TRD-09 §4.3). auto picks reels for
// portrait and landscape otherwise.
function margins(zone: SafeZone, width: number, height: number): { v: number; h: number } {
  const resolved = zone === 'auto' ? (height > width ? 'reels' : 'landscape') : zone;
  if (resolved === 'reels') return { v: Math.round(height * 0.167), h: Math.round(width * 0.11) };
  if (resolved === 'landscape') return { v: Math.round(height * 0.17), h: Math.round(width * 0.075) };
  return { v: Math.round(height * 0.05), h: Math.round(width * 0.04) };
}

export function buildAss(cues: Cue[], options: AssOptions): string {
  const { width, height } = options;
  const look = options.look ?? 'clean';
  const style = styleFor(look, Math.min(width, height));
  const { v, h } = margins(options.safeZone ?? 'auto', width, height);
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV',
    `Style: Kilnry,${style.fontName},${style.fontSize},${style.primary},${style.outline},${style.borderStyle},${style.outlineWidth},${style.shadow},2,${h},${h},${v}`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const events = cues.map(
    (cue) =>
      `Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},Kilnry,,0,0,0,,${escapeAssText(cue.text)}`,
  );
  return `${[...header, ...events].join('\n')}\n`;
}

// Escape the libass filter-option value so a Kilnry-owned path with a colon,
// backslash or quote is passed to the ass filter intact (TRD-09 §3.6).
export function escapeFilterPath(path: string): string {
  return path.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assTime, buildAss, escapeAssText, escapeFilterPath } from './ass.js';
import { applyAuthored, buildCues } from './transcript.js';
import { assForVideo, burnCaptions, fontsDir } from './burn.js';
import { probeMedia } from '../probe.js';
import { runMediaProcess } from '../process.js';

const ffmpeg = process.env.KILNRY_FFMPEG ?? 'ffmpeg';
const ffmpegAvailable = spawnSync(ffmpeg, ['-version'], { stdio: 'ignore' }).status === 0;
// libass is needed for the ass filter; the homebrew ffmpeg often lacks it, the
// CI static build has it. The ASS content is asserted either way.
const libass =
  ffmpegAvailable &&
  spawnSync(ffmpeg, ['-hide_banner', '-filters'], { encoding: 'utf8' }).stdout?.includes(' ass ');

let root: string;
afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});
beforeAll(async () => {
  if (!ffmpegAvailable) return;
  root = mkdtempSync(join(tmpdir(), 'kilnry-captions-'));
}, 60_000);

const WORDS = [
  { w: 'Hello', start: 0.1, end: 0.4 },
  { w: 'there,', start: 0.5, end: 0.8 },
  { w: 'friend.', start: 0.9, end: 1.3 },
  { w: 'Another', start: 2.2, end: 2.6 },
  { w: 'line.', start: 2.7, end: 3.0 },
];

describe('caption cues and ASS (F-WFL-06, TRD-09 §4)', () => {
  it('closes a cue at sentence punctuation and across a 0.6 s gap', () => {
    const cues = buildCues(WORDS, { maxWords: 5, maxChars: 32 });
    expect(cues).toHaveLength(2);
    expect(cues[0]!.text).toBe('Hello there, friend.');
    expect(cues[1]!.text).toBe('Another line.');
    // The first cue starts 0.05 s before its first word.
    expect(cues[0]!.start).toBeCloseTo(0.05, 2);
  });

  it('splits on max words and max chars', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ w: `w${i}`, start: i * 0.3, end: i * 0.3 + 0.2 }));
    expect(buildCues(many, { maxWords: 3, maxChars: 99 }).length).toBeGreaterThan(1);
  });

  it('keeps the authored spelling when the token count matches', () => {
    const aligned = applyAuthored(
      [
        { w: 'kilnry', start: 0, end: 0.3 },
        { w: 'ai', start: 0.4, end: 0.6 },
      ],
      ['Kilnry', 'AI'],
    );
    expect(aligned.map((word) => word.w)).toEqual(['Kilnry', 'AI']);
  });

  it('formats ASS centiseconds and escapes event text and filter paths', () => {
    expect(assTime(3661.25)).toBe('1:01:01.25');
    expect(escapeAssText('a {b} \\c')).toBe('a \\{b\\} \\\\c');
    expect(escapeFilterPath("/a:b/c'd")).toBe("/a\\:b/c\\'d");
  });

  it('builds the clean look with Inter and a portrait reels safe zone', () => {
    const ass = buildAss(buildCues(WORDS), { width: 1080, height: 1920, look: 'clean', safeZone: 'auto' });
    expect(ass).toContain('Style: Kilnry,Inter,');
    expect(ass).toContain('PlayResX: 1080');
    expect(ass).toContain('Dialogue: 0,');
    // reels bottom margin is 16.7 % of 1920 ≈ 320.
    expect(ass).toMatch(/,32\d$/m);
  });

  it('ships the Inter SemiBold font libass finds through fontsdir', () => {
    expect(existsSync(join(fontsDir(), 'Inter-SemiBold.ttf'))).toBe(true);
  });

  it.skipIf(!ffmpegAvailable)('builds an ASS for a real video size without rendering', async () => {
    const video = join(root, 'clip.mp4');
    await runMediaProcess(
      ffmpeg,
      [
        '-hide_banner',
        '-nostdin',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=1080x1920:rate=24:duration=3',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=3',
        '-pix_fmt',
        'yuv420p',
        '-c:v',
        'libx264',
        '-c:a',
        'aac',
        '-shortest',
        video,
      ],
      { timeoutMs: 60_000 },
    );
    const ass = await assForVideo(video, {
      kilnry_transcript: 1,
      language: 'en',
      duration_s: 3,
      source: 'fal',
      words: WORDS,
    });
    expect(ass).toContain('PlayResX: 1080');
    expect(ass).toContain('PlayResY: 1920');
  });

  it.skipIf(!libass)('burns captions into the video with the ass filter', async () => {
    const video = join(root, 'clip2.mp4');
    await runMediaProcess(
      ffmpeg,
      [
        '-hide_banner',
        '-nostdin',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=720x1280:rate=24:duration=2',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=2',
        '-pix_fmt',
        'yuv420p',
        '-c:v',
        'libx264',
        '-c:a',
        'aac',
        '-shortest',
        video,
      ],
      { timeoutMs: 60_000 },
    );
    const out = join(root, 'burned.mp4');
    await burnCaptions(
      video,
      { kilnry_transcript: 1, language: 'en', duration_s: 2, source: 'fal', words: WORDS },
      out,
    );
    const probe = await probeMedia(out);
    expect(probe.mime).toBe('video/mp4');
    expect(probe.has_audio).toBe(true);
  });
});

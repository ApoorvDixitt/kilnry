// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The assembly operations run against a real ffmpeg (CI has one; these skip when
// it is missing). An assemble step is only real if it writes a playable file, so
// each case renders and then probes the result: a concat of a still, a silent
// clip and a clip with sound produces one video of the summed length with a
// usable audio track; mux replaces or mixes audio; extract pulls audio and
// frames; probe reports the real duration (TRD-09 §3).

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ffmpegArgs, runFfmpegOp } from './ffmpeg-ops.js';
import { probeMedia } from './probe.js';
import { runMediaProcess } from './process.js';

const ffmpeg = process.env.KILNRY_FFMPEG ?? 'ffmpeg';
const ffmpegAvailable = spawnSync(ffmpeg, ['-version'], { stdio: 'ignore' }).status === 0;
let root: string;
let silent: string;
let sound: string;
let still: string;
let voice: string;

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

async function run(args: string[]): Promise<void> {
  await runMediaProcess(ffmpeg, args, { timeoutMs: 60_000 });
}

beforeAll(async () => {
  if (!ffmpegAvailable) return;
  root = mkdtempSync(join(tmpdir(), 'kilnry-assembly-'));
  silent = join(root, 'silent.mp4');
  sound = join(root, 'sound.mp4');
  still = join(root, 'still.png');
  voice = join(root, 'voice.m4a');
  await run([
    '-hide_banner',
    '-nostdin',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=160x120:rate=24:duration=2',
    '-pix_fmt',
    'yuv420p',
    '-c:v',
    'libx264',
    silent,
  ]);
  await run([
    '-hide_banner',
    '-nostdin',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=160x120:rate=24:duration=2',
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
    sound,
  ]);
  await run([
    '-hide_banner',
    '-nostdin',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=red:size=160x120',
    '-frames:v',
    '1',
    still,
  ]);
  await run(['-hide_banner', '-nostdin', '-y', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=3', voice]);
}, 120_000);

describe('assembly ops on a real ffmpeg (F-WFL-06, TRD-09 §3)', () => {
  it.skipIf(!ffmpegAvailable)(
    'concats a still, a silent clip and a clip with sound into one playable video',
    async () => {
      const out = join(root, 'cut.mp4');
      await runFfmpegOp('concat', [still, silent, sound], out, {
        image_hold_s: 2,
        target: { width: 160, height: 120, fps: 24 },
        sources: [
          { still: true },
          { still: false, has_audio: false, duration_s: 2 },
          { still: false, has_audio: true, duration_s: 2 },
        ],
      });
      expect(existsSync(out)).toBe(true);
      const probe = await probeMedia(out);
      expect(probe.mime).toBe('video/mp4');
      expect(probe.has_audio).toBe(true);
      // Still hold (2) + silent (2) + sound (2) ≈ 6 s.
      expect(probe.duration_s ?? 0).toBeGreaterThan(5);
      expect(probe.duration_s ?? 0).toBeLessThan(7.5);
    },
  );

  it.skipIf(!ffmpegAvailable)('joins voice takes with concat mode audio', async () => {
    const out = join(root, 'voices.m4a');
    await runFfmpegOp('concat', [voice, voice], out, { mode: 'audio' });
    const probe = await probeMedia(out);
    expect(probe.has_audio).toBe(true);
    expect(probe.duration_s ?? 0).toBeGreaterThan(5);
  });

  it.skipIf(!ffmpegAvailable)('mux_audio replace swaps the track; mix keeps both', async () => {
    const replaced = join(root, 'replace.mp4');
    await runFfmpegOp('mux_audio', [silent, voice], replaced, { mode: 'replace' });
    expect((await probeMedia(replaced)).has_audio).toBe(true);
    const mixed = join(root, 'mix.mp4');
    await runFfmpegOp('mux_audio', [sound, voice], mixed, { mode: 'mix', audio_gain_db: -6 });
    const probe = await probeMedia(mixed);
    expect(probe.has_audio).toBe(true);
    expect(probe.duration_s ?? 0).toBeGreaterThan(1.5);
  });

  it.skipIf(!ffmpegAvailable)('extracts audio and frames', async () => {
    const audio = join(root, 'track.mp3');
    await runFfmpegOp('extract_audio', [sound], audio);
    expect((await probeMedia(audio)).mime).toMatch(/audio\//);
    const frames = join(root, 'frame_%04d.png');
    await runFfmpegOp('extract_frames', [sound], frames, { fps: 1 });
    expect(readdirSync(root).some((name) => /^frame_\d+\.png$/.test(name))).toBe(true);
  });

  it.skipIf(!ffmpegAvailable)('probe reports the real duration', async () => {
    const probe = await probeMedia(sound);
    expect(probe.duration_s ?? 0).toBeGreaterThan(1.5);
    expect(probe.duration_s ?? 0).toBeLessThan(2.6);
  });

  it.skipIf(!ffmpegAvailable)('overlays an image onto a video within a time window', async () => {
    const out = join(root, 'overlaid.mp4');
    await runFfmpegOp('overlay_image', [sound, still], out, {
      position: 'top_right',
      width_pct: 40,
      margin_px: 8,
      start: 0,
      end: 1,
    });
    const probe = await probeMedia(out);
    expect(probe.mime).toBe('video/mp4');
    expect(probe.has_audio).toBe(true);
  });

  it.skipIf(!ffmpegAvailable)('normalises audio loudness, keeping the video stream', async () => {
    const out = join(root, 'normalised.mp4');
    await runFfmpegOp('normalize_audio', [sound], out, { target_lufs: -16, true_peak_dbtp: -1.5 });
    const probe = await probeMedia(out);
    expect(probe.has_audio).toBe(true);
    expect(probe.mime).toBe('video/mp4');
  });

  it('rejects concat with no inputs without touching ffmpeg', () => {
    expect(() => ffmpegArgs('concat', [], '/out.mp4')).toThrow();
  });
});

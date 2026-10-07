// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { FFMPEG_OPS, ffmpegArgs, isSupportedFfmpegOp } from './ffmpeg-ops.js';

describe('ffmpeg-ops (F-MCP-02)', () => {
  it('recognises only the supported operations', () => {
    expect(isSupportedFfmpegOp('trim')).toBe(true);
    expect(isSupportedFfmpegOp('burn_captions')).toBe(false);
    expect(FFMPEG_OPS).toContain('sprite_sheet');
  });

  it('builds a trim command with start and duration', () => {
    const args = ffmpegArgs('trim', ['/in.mp4'], '/out.mp4', { start_s: 2, duration_s: 5 });
    expect(args).toContain('-ss');
    expect(args).toContain('2');
    expect(args).toContain('-t');
    expect(args).toContain('5');
    expect(args.at(-1)).toBe('/out.mp4');
  });

  it('builds a resize scale filter', () => {
    const args = ffmpegArgs('resize', ['/in.mp4'], '/out.mp4', { width: 640, height: 480 });
    expect(args.join(' ')).toContain('scale=640:480');
  });

  it('builds a concat filter over multiple inputs', () => {
    const args = ffmpegArgs('concat', ['/a.mp4', '/b.mp4'], '/out.mp4');
    expect(args.join(' ')).toContain('concat=n=2:v=1:a=1');
  });

  it('normalises a single-input concat to the target rather than rejecting it', () => {
    // A clips loop that produced one clip concats one input (TRD-09 §3.3 ladder).
    const args = ffmpegArgs('concat', ['/a.mp4'], '/out.mp4');
    expect(args.join(' ')).toContain('concat=n=1:v=1:a=1');
  });

  it('rejects concat with no inputs', () => {
    expect(() => ffmpegArgs('concat', [], '/out.mp4')).toThrow();
  });

  it('builds a gif filter with fps and scale', () => {
    const args = ffmpegArgs('gif', ['/in.mp4'], '/out.gif', { fps: 10, width: 320 });
    expect(args.join(' ')).toContain('fps=10');
    expect(args.join(' ')).toContain('scale=320:-1');
  });

  it('mux_audio replace delays by offset_s and bounds apad to fit_duration_s (TRD-09 §3.8)', () => {
    const args = ffmpegArgs('mux_audio', ['/v.mp4', '/a.wav'], '/out.mp4', {
      mode: 'replace',
      offset_s: 1,
      fit: 'video',
      fit_duration_s: 2.5,
    });
    const filter = args.join(' ');
    expect(filter).toContain('adelay=1000:all=1');
    expect(filter).toContain('apad=whole_dur=2.500');
    expect(filter).toContain('atrim=end=2.500');
    expect(filter).toContain('-shortest');
  });

  it('mux_audio fit=shortest pads nothing and keeps -shortest', () => {
    const args = ffmpegArgs('mux_audio', ['/v.mp4', '/a.wav'], '/out.mp4', {
      mode: 'replace',
      fit: 'shortest',
      fit_duration_s: 2.5,
    });
    const filter = args.join(' ');
    expect(filter).not.toContain('apad');
    expect(filter).not.toContain('adelay');
    expect(filter).toContain('-shortest');
  });

  it('mux_audio rejects an unimplemented fit', () => {
    expect(() =>
      ffmpegArgs('mux_audio', ['/v.mp4', '/a.wav'], '/out.mp4', { mode: 'replace', fit: 'loop_audio' }),
    ).toThrow(/not implemented in V1/);
  });

  it('mux_audio fit=video without fit_duration_s throws instead of padding nothing', () => {
    expect(() =>
      ffmpegArgs('mux_audio', ['/v.mp4', '/a.wav'], '/out.mp4', { mode: 'replace', fit: 'video' }),
    ).toThrow(/fit=video needs fit_duration_s/);
  });

  // F-42 and F-43: extract_frames read only `fps`, so `mode: scene` with a
  // threshold sampled one frame a second and W3's cut counter counted seconds;
  // concat never read `gap_s`, so the narrator's takes were joined with no pause.
  it('builds the scene-mode select filter TRD-09 §3.9 documents', () => {
    const argv = ffmpegArgs('extract_frames', ['in.mp4'], 'out_%03d.jpg', {
      mode: 'scene',
      scene_threshold: 0.35,
      max_width: 1280,
    });
    expect(argv.join(' ')).toContain("select='gt(scene,0.35)'");
    expect(argv.join(' ')).toContain("scale='min(1280,iw)':-2");
    expect(argv).toContain('-vsync');
    expect(argv).toContain('vfr');
  });

  it('counts frames in count mode and samples in every_n_seconds mode', () => {
    const counted = ffmpegArgs('extract_frames', ['in.mp4'], 'out_%03d.jpg', {
      mode: 'count',
      count: 12,
      duration_s: 24,
    }).join(' ');
    expect(counted).toContain('fps=12/24');
    expect(counted).toContain('-frames:v 12');
    const sampled = ffmpegArgs('extract_frames', ['in.mp4'], 'out_%03d.jpg', {
      mode: 'every_n_seconds',
      n: 5,
    }).join(' ');
    expect(sampled).toContain('fps=1/5');
  });

  it('puts silence between audio takes when concat is given a gap', () => {
    const argv = ffmpegArgs('concat', ['a.mp3', 'b.mp3', 'c.mp3'], 'joined.mp3', {
      mode: 'audio',
      gap_s: 0.6,
    }).join(' ');
    expect(argv).toContain('anullsrc=r=48000:cl=stereo');
    expect(argv).toContain('-t 0.6');
    // Three takes and two gaps.
    expect(argv).toContain('concat=n=5:v=0:a=1');
  });
});

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

  it('rejects concat with a single input', () => {
    expect(() => ffmpegArgs('concat', ['/a.mp4'], '/out.mp4')).toThrow();
  });

  it('builds a gif filter with fps and scale', () => {
    const args = ffmpegArgs('gif', ['/in.mp4'], '/out.gif', { fps: 10, width: 320 });
    expect(args.join(' ')).toContain('fps=10');
    expect(args.join(' ')).toContain('scale=320:-1');
  });
});

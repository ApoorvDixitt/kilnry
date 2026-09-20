// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Named, free, local FFmpeg operations for kilnry_ffmpeg (F-MCP-02, TRD-09 §3).
// No raw argv is ever accepted (D-45): each operation is a fixed argument
// builder over validated parameters. The builders are pure so they can be unit
// tested without spawning FFmpeg; runFfmpegOp spawns the shared media process.

import { runMediaProcess } from './process.js';

// The operations kilnry_ffmpeg can serve today. Anything outside this list is
// not available yet and the tool names its milestone.
export const FFMPEG_OPS = [
  'probe',
  'thumbnail',
  'sprite_sheet',
  'extract_frames',
  'trim',
  'concat',
  'resize',
  'pad_to_aspect',
  'gif',
  'extract_audio',
  'mux_audio',
  'speed',
  'loop',
] as const;

export type FfmpegOp = (typeof FFMPEG_OPS)[number];

export function isSupportedFfmpegOp(op: string): op is FfmpegOp {
  return (FFMPEG_OPS as readonly string[]).includes(op);
}

// The aspect ratio as width:height for the pad filter.
function aspectPad(target: string): string {
  const [w, h] = target.split(':').map((part) => Number(part.trim()));
  if (!w || !h) throw new Error(`Invalid aspect ratio: ${target}.`);
  return `${w}/${h}`;
}

// Build the FFmpeg arguments for an operation writing to `output`. The first
// input is `inputs[0]`; concat and mux use more. Numbers are coerced from the
// loosely typed params the tool receives.
export function ffmpegArgs(
  op: FfmpegOp,
  inputs: string[],
  output: string,
  params: Record<string, unknown> = {},
): string[] {
  const input = inputs[0];
  if (op !== 'concat' && !input) throw new Error('This operation needs one input.');
  const base = ['-hide_banner', '-nostdin', '-y'];
  const num = (key: string, fallback: number): number => {
    const value = params[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  };

  switch (op) {
    case 'thumbnail':
      return [...base, '-i', input!, '-frames:v', '1', '-vf', `scale=${num('width', 320)}:-1`, output];
    case 'extract_frames':
      return [...base, '-i', input!, '-vf', `fps=${num('fps', 1)}`, output];
    case 'sprite_sheet':
      return [
        ...base,
        '-i',
        input!,
        '-vf',
        `fps=${num('fps', 1)},scale=${num('width', 160)}:-1,tile=${num('cols', 5)}x${num('rows', 5)}`,
        '-frames:v',
        '1',
        output,
      ];
    case 'trim':
      return [
        ...base,
        '-ss',
        String(num('start_s', 0)),
        '-i',
        input!,
        '-t',
        String(num('duration_s', 5)),
        '-c',
        'copy',
        output,
      ];
    case 'resize':
      return [...base, '-i', input!, '-vf', `scale=${num('width', 1280)}:${num('height', -2)}`, output];
    case 'pad_to_aspect':
      return [
        ...base,
        '-i',
        input!,
        '-vf',
        `pad=ceil(max(iw\\,ih*${aspectPad(String(params.target_aspect ?? '1:1'))})/2)*2:ceil(max(ih\\,iw/(${aspectPad(String(params.target_aspect ?? '1:1'))}))/2)*2:(ow-iw)/2:(oh-ih)/2`,
        output,
      ];
    case 'gif':
      return [
        ...base,
        '-i',
        input!,
        '-vf',
        `fps=${num('fps', 12)},scale=${num('width', 480)}:-1:flags=lanczos`,
        output,
      ];
    case 'extract_audio':
      return [...base, '-i', input!, '-vn', '-acodec', 'libmp3lame', output];
    case 'speed': {
      const factor = num('factor', 2);
      return [
        ...base,
        '-i',
        input!,
        '-filter_complex',
        `[0:v]setpts=${(1 / factor).toFixed(4)}*PTS[v]`,
        '-map',
        '[v]',
        output,
      ];
    }
    case 'loop':
      return [...base, '-stream_loop', String(num('count', 1)), '-i', input!, '-c', 'copy', output];
    case 'concat': {
      if (inputs.length < 2) throw new Error('Concat needs at least two inputs.');
      const args = [...base];
      for (const source of inputs) args.push('-i', source);
      const streams = inputs.map((_, index) => `[${index}:v][${index}:a]`).join('');
      return [
        ...args,
        '-filter_complex',
        `${streams}concat=n=${inputs.length}:v=1:a=1[v][a]`,
        '-map',
        '[v]',
        '-map',
        '[a]',
        output,
      ];
    }
    case 'mux_audio': {
      const audio = inputs[1];
      if (!audio) throw new Error('Muxing needs a video and an audio input.');
      return [
        ...base,
        '-i',
        input!,
        '-i',
        audio,
        '-c:v',
        'copy',
        '-map',
        '0:v:0',
        '-map',
        '1:a:0',
        '-shortest',
        output,
      ];
    }
    case 'probe':
      // Probe is handled by probeMedia in the tool, not by an FFmpeg render.
      return [];
  }
}

// Run an FFmpeg operation, producing `output`. Returns the trimmed log tail.
export async function runFfmpegOp(
  op: FfmpegOp,
  inputs: string[],
  output: string,
  params: Record<string, unknown> = {},
  ffmpeg = process.env.KILNRY_FFMPEG ?? 'ffmpeg',
): Promise<{ log_tail: string }> {
  const args = ffmpegArgs(op, inputs, output, params);
  const result = await runMediaProcess(ffmpeg, args, { timeoutMs: 120_000 });
  const log = `${result.stderr}`.trim().split('\n').slice(-20).join('\n');
  return { log_tail: log };
}

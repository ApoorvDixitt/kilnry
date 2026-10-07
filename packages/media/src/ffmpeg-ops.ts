// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Named, free, local FFmpeg operations for kilnry_ffmpeg (F-MCP-02, TRD-09 §3).
// No raw argv is ever accepted (D-45): each operation is a fixed argument
// builder over validated parameters. The builders are pure so they can be unit
// tested without spawning FFmpeg; runFfmpegOp spawns the shared media process.

import { runMediaProcess } from './process.js';
import { probeMedia } from './probe.js';

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
  'overlay_image',
  'normalize_audio',
] as const;

export type FfmpegOp = (typeof FFMPEG_OPS)[number];

export function isSupportedFfmpegOp(op: string): op is FfmpegOp {
  return (FFMPEG_OPS as readonly string[]).includes(op);
}

// The output file extension a local FFmpeg operation writes.
export function ffmpegExtension(op: string): string {
  if (op === 'gif') return '.gif';
  if (op === 'extract_audio') return '.mp3';
  if (op === 'thumbnail' || op === 'sprite_sheet') return '.png';
  if (op === 'overlay_text') return '.png';
  if (op === 'extract_frames') return '_%04d.png';
  return '.mp4';
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
    case 'extract_frames': {
      // TRD-09 §3.9 gives this op four modes and five parameters; it read `fps`
      // and nothing else, so `mode: scene` with a `scene_threshold` sampled at
      // one frame a second instead of one frame per cut — and W3's cut counter
      // therefore counted seconds (F-42). `format` and `max_width` were dropped
      // the same way; the caller names the output extension, so `format` is
      // honoured by the caller and the scale is applied here.
      const width = num('max_width', 1920);
      const scale = `scale='min(${width},iw)':-2`;
      const mode = typeof params.mode === 'string' ? params.mode : 'count';
      if (mode === 'scene') {
        const threshold = num('scene_threshold', 0.4);
        return [
          ...base,
          '-i',
          input!,
          '-vf',
          `select='gt(scene,${threshold})',${scale}`,
          '-vsync',
          'vfr',
          output,
        ];
      }
      if (mode === 'every_n_seconds') {
        const every = num('n', num('fps', 1) > 0 ? 1 / num('fps', 1) : 1);
        return [...base, '-i', input!, '-vf', `fps=1/${every},${scale}`, output];
      }
      if (mode === 'count') {
        const count = Math.round(num('count', 12));
        const duration = num('duration_s', 0);
        const rate = duration > 0 ? `${count}/${duration}` : String(num('fps', 1));
        return [...base, '-i', input!, '-vf', `fps=${rate},${scale}`, '-frames:v', String(count), output];
      }
      // Anything else keeps the old fps behaviour rather than guessing.
      return [...base, '-i', input!, '-vf', `fps=${num('fps', 1)},${scale}`, output];
    }
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
      if (inputs.length < 1) throw new Error('Concat needs at least one input.');
      // An audio-only join (narrator stitches voice takes): concat the audio
      // streams, no video.
      if (String(params.mode ?? '') === 'audio') {
        const gapSeconds = num('gap_s', 0);
        const args = [...base];
        for (const source of inputs) args.push('-i', source);
        if (gapSeconds > 0) {
          // One silence input, reused between every pair (TRD-12 §6.3 gap_s).
          args.push('-f', 'lavfi', '-t', String(gapSeconds), '-i', 'anullsrc=r=48000:cl=stereo');
          const silence = `[${inputs.length}:a]`;
          const streams = inputs
            .map((_, index) => (index === 0 ? `[${index}:a]` : `${silence}[${index}:a]`))
            .join('');
          const pieces = inputs.length * 2 - 1;
          return [
            ...args,
            '-filter_complex',
            `${streams}concat=n=${pieces}:v=0:a=1[a]`,
            '-map',
            '[a]',
            output,
          ];
        }
        const streams = inputs.map((_, index) => `[${index}:a]`).join('');
        return [
          ...args,
          '-filter_complex',
          `${streams}concat=n=${inputs.length}:v=0:a=1[a]`,
          '-map',
          '[a]',
          output,
        ];
      }
      // The re-encode ladder (TRD-09 §3.3): a still image becomes a held clip of
      // image_hold_s seconds, every input is scaled and padded to one target and
      // given a stereo audio track (silence of the clip's own length when it has
      // none), then the inputs are concatenated. This lets the faceless stills
      // mode and any mix of clips and images join without a stream mismatch. The
      // host passes each input's audio flag and duration under `sources`.
      const hold = num('image_hold_s', 4);
      // TRD-12 §6.3 lists `gap_s` for concat and the builder never read it, so
      // the narrator's takes were joined with no pause between them (F-43). A
      // gap is silence of that length between the pieces, with a held black
      // frame so the video and audio stay the same length.
      const gap = num('gap_s', 0);
      const [tw, th] = targetDimensions(params);
      const fps = targetFps(params);
      const sources = Array.isArray(params.sources)
        ? (params.sources as Array<{ still?: boolean; has_audio?: boolean; duration_s?: number }>)
        : [];
      const args = [...base];
      const chains: string[] = [];
      const pairs: string[] = [];
      inputs.forEach((source, index) => {
        const info = sources[index] ?? {};
        const still = info.still ?? isStillImage(source);
        const clipLength = still ? hold : (info.duration_s ?? 0) > 0 ? info.duration_s! : undefined;
        if (still) {
          args.push('-loop', '1', '-framerate', String(fps), '-t', String(hold), '-i', source);
        } else {
          args.push('-i', source);
        }
        chains.push(
          `[${index}:v]scale=${tw}:${th}:force_original_aspect_ratio=decrease,` +
            `pad=${tw}:${th}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps},format=yuv420p[v${index}]`,
        );
        if (!still && info.has_audio !== false) {
          chains.push(`[${index}:a]aresample=48000,aformat=channel_layouts=stereo[a${index}]`);
        } else {
          // Silence of the clip's own length (bounded, so concat terminates).
          const duration = clipLength !== undefined ? `:d=${clipLength}` : '';
          chains.push(`anullsrc=r=48000:cl=stereo${duration}[a${index}]`);
        }
        pairs.push(`[v${index}][a${index}]`);
      });
      // A gap between the pieces is a held black frame with silence, so the
      // video and the audio stay the same length (TRD-12 §6.3 gap_s, F-43).
      if (gap > 0 && inputs.length > 1) {
        const spacer = inputs.length;
        args.push('-f', 'lavfi', '-t', String(gap), '-i', `color=c=black:s=${tw}x${th}:r=${fps}`);
        args.push('-f', 'lavfi', '-t', String(gap), '-i', 'anullsrc=r=48000:cl=stereo');
        chains.push(`[${spacer}:v]setsar=1,format=yuv420p[vgap]`);
        chains.push(`[${spacer + 1}:a]aresample=48000,aformat=channel_layouts=stereo[agap]`);
        const spaced = pairs.flatMap((pair, index) => (index === 0 ? [pair] : ['[vgap][agap]', pair]));
        return [
          ...args,
          '-filter_complex',
          `${chains.join(';')};${spaced.join('')}concat=n=${spaced.length}:v=1:a=1[v][a]`,
          '-map',
          '[v]',
          '-map',
          '[a]',
          '-c:v',
          'libx264',
          '-crf',
          '18',
          '-c:a',
          'aac',
          '-movflags',
          '+faststart',
          output,
        ];
      }
      return [
        ...args,
        '-filter_complex',
        `${chains.join(';')};${pairs.join('')}concat=n=${inputs.length}:v=1:a=1[v][a]`,
        '-map',
        '[v]',
        '-map',
        '[a]',
        '-c:v',
        'libx264',
        '-crf',
        '18',
        '-c:a',
        'aac',
        '-movflags',
        '+faststart',
        output,
      ];
    }
    case 'mux_audio': {
      const audio = inputs[1];
      if (!audio) throw new Error('Muxing needs a video and an audio input.');
      const mode = String(params.mode ?? 'replace');
      const gain = num('audio_gain_db', num('gain_db', 0));
      const offset = num('offset_s', 0);
      const fit = String(params.fit ?? 'video');
      // offset_s shifts the new audio later by delaying every channel; a
      // negative offset is clamped to 0 (the spec's max(0,offset)), since a
      // track cannot start before zero. adelay all=1 applies the one delay to
      // every channel (verified: ffmpeg -h filter=adelay lists `all`).
      const delayMs = Math.round(Math.max(0, offset) * 1000);
      const adelay = delayMs > 0 ? `adelay=${delayMs}:all=1,` : '';
      // fit=video pads the shorter audio with silence to the video's length and
      // cuts a longer one — the voice sits inside its block (TRD-09 §3.8,
      // CR-09-2). apad is BOUNDED by whole_dur = the probed video duration and
      // the result trimmed to it, so it terminates on every build; an unbounded
      // apad hung on the static ffmpeg 7.0.2 under -c:v copy -shortest. The host
      // passes the duration as fit_duration_s (verified: apad has whole_dur,
      // atrim has end). fit=shortest cuts both to the shorter: no pad.
      const fitDuration = num('fit_duration_s', 0);
      if (fit === 'loop_audio' || fit === 'pad_silence') {
        throw new Error(`mux_audio fit=${fit} is not implemented in V1 (default; adjustable)`);
      }
      if (mode === 'mix' || mode === 'under') {
        return [
          ...base,
          '-i',
          input!,
          '-i',
          audio,
          '-filter_complex',
          `[0:a]volume=${num('video_gain_db', 0)}dB[a0];[1:a]${adelay}volume=${gain}dB[a1];` +
            `[a0][a1]amix=inputs=2:duration=first:normalize=0[a]`,
          '-map',
          '0:v:0',
          '-map',
          '[a]',
          '-c:v',
          'copy',
          '-c:a',
          'aac',
          '-shortest',
          output,
        ];
      }
      // fit=video pads the audio to the video's length, which needs the probed
      // duration. Without it the old code silently fell back to -shortest, which
      // is the 04fd468 regression for any caller that forgets fit_duration_s
      // (the MCP media tool did). Refuse rather than pad nothing (AGENTS.md §6: a
      // param the builder ignores is a defect). runFfmpegOp probes it in; a
      // caller that builds argv directly must pass it.
      if (fit === 'video' && fitDuration <= 0) {
        throw new Error('mux_audio fit=video needs fit_duration_s (the probed video duration).');
      }
      const pad =
        fit === 'video'
          ? `apad=whole_dur=${fitDuration.toFixed(3)},atrim=end=${fitDuration.toFixed(3)},`
          : '';
      return [
        ...base,
        '-i',
        input!,
        '-i',
        audio,
        '-filter_complex',
        `[1:a]${adelay}volume=${gain}dB,${pad}anull[a]`,
        '-c:v',
        'copy',
        '-map',
        '0:v:0',
        '-map',
        '[a]',
        '-c:a',
        'aac',
        '-shortest',
        output,
      ];
    }
    case 'overlay_image': {
      // A watermark or site shot composited onto a video (TRD-09 §3.4). The
      // overlay is scaled to width_pct of the base and placed by position; an
      // optional window shows it only between start and end.
      const overlay = inputs[1];
      if (!overlay) throw new Error('Overlay needs a base and an overlay image.');
      const scalePct = num('width_pct', 30) / 100;
      const margin = num('margin_px', 24);
      const opacity = num('opacity', 1);
      const [x, y] = overlayPosition(String(params.position ?? 'bottom_right'), margin);
      const window =
        params.start !== undefined && params.end !== undefined
          ? `:enable='between(t,${num('start', 0)},${num('end', 0)})'`
          : '';
      return [
        ...base,
        '-i',
        input!,
        '-i',
        overlay,
        '-filter_complex',
        `[1:v]format=rgba,scale=iw*${scalePct}:-1,colorchannelmixer=aa=${opacity}[ov];` +
          `[0:v][ov]overlay=x=${x}:y=${y}${window}[v]`,
        '-map',
        '[v]',
        '-map',
        '0:a?',
        '-c:v',
        'libx264',
        '-crf',
        '18',
        '-c:a',
        'copy',
        output,
      ];
    }
    case 'normalize_audio':
      // Loudness normalise to a target LUFS and true peak (TRD-09 §3.18). A
      // single-pass loudnorm, which is enough for the workflow bed and voice.
      return [
        ...base,
        '-i',
        input!,
        '-af',
        `loudnorm=I=${num('target_lufs', -16)}:TP=${num('true_peak_dbtp', -1.5)}:LRA=${num('lra', 11)}`,
        '-c:v',
        'copy',
        output,
      ];
    case 'probe':
      // Probe is handled by probeMedia in the tool, not by an FFmpeg render.
      return [];
  }
}

// A target width:height for the concat ladder from the step's `target` (a
// {width,height} or {aspect,resolution}) or a sensible portrait-safe default.
function targetDimensions(params: Record<string, unknown>): [number, number] {
  const target = (params.target ?? {}) as Record<string, unknown>;
  const w = Number(target.width);
  const h = Number(target.height);
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return [Math.round(w), Math.round(h)];
  const resolution = String(target.resolution ?? '1080p');
  const short = resolution === '720p' ? 720 : resolution === '4k' ? 2160 : 1080;
  const aspect = String(target.aspect ?? '9:16');
  const [aw, ah] = aspect.split(':').map((part) => Number(part.trim()));
  if (aw && ah && aw > ah) return [Math.round((short * aw) / ah), short];
  if (aw && ah) return [short, Math.round((short * ah) / aw)];
  return [short, Math.round((short * 16) / 9)];
}

function targetFps(params: Record<string, unknown>): number {
  const target = (params.target ?? {}) as Record<string, unknown>;
  const fps = Number(target.fps);
  return Number.isFinite(fps) && fps > 0 ? Math.round(fps) : 30;
}

// ffmpeg overlay x/y expressions for a position with an edge margin (TRD-09
// §3.4): main_w/main_h are the base, overlay_w/overlay_h the overlay.
function overlayPosition(position: string, margin: number): [string, string] {
  const left = `${margin}`;
  const right = `main_w-overlay_w-${margin}`;
  const hCenter = `(main_w-overlay_w)/2`;
  const top = `${margin}`;
  const bottom = `main_h-overlay_h-${margin}`;
  const vCenter = `(main_h-overlay_h)/2`;
  const map: Record<string, [string, string]> = {
    top_left: [left, top],
    top: [hCenter, top],
    top_right: [right, top],
    left: [left, vCenter],
    center: [hCenter, vCenter],
    right: [right, vCenter],
    bottom_left: [left, bottom],
    bottom: [hCenter, bottom],
    bottom_right: [right, bottom],
  };
  return map[position] ?? map.bottom_right!;
}

export const STILL_IMAGE = /\.(png|jpe?g|webp|avif|bmp|tiff?)$/i;
function isStillImage(source: string): boolean {
  return STILL_IMAGE.test(source.split('?')[0] ?? source);
}

// Run an FFmpeg operation, producing `output`. Returns the trimmed log tail.
export async function runFfmpegOp(
  op: FfmpegOp,
  inputs: string[],
  output: string,
  params: Record<string, unknown> = {},
  ffmpeg = process.env.KILNRY_FFMPEG ?? 'ffmpeg',
): Promise<{ log_tail: string }> {
  // mux_audio fit=video needs the video's duration to bound apad. The workflow
  // host probes it in (workflows.ts), but a direct caller — the MCP media tool
  // (tools/generation.ts) — does not, so probe inputs[0] here when it is absent
  // and the fit is video (the default), rather than let the builder throw.
  let opParams = params;
  if (
    op === 'mux_audio' &&
    (params.fit ?? 'video') === 'video' &&
    typeof params.fit_duration_s !== 'number' &&
    inputs[0]
  ) {
    const probed = await probeMedia(inputs[0]);
    opParams = { ...params, fit_duration_s: probed.duration_s ?? 0 };
  }
  const args = ffmpegArgs(op, inputs, output, opParams);
  const result = await runMediaProcess(ffmpeg, args, { timeoutMs: 120_000 });
  const log = `${result.stderr}`.trim().split('\n').slice(-20).join('\n');
  return { log_tail: log };
}

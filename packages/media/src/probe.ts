// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { stat } from 'node:fs/promises';
import sharp from 'sharp';
import { runMediaProcess } from './process.js';
import { sniffMime } from './sniff.js';

export interface MediaProbe {
  mime: string;
  bytes: number;
  width?: number;
  height?: number;
  duration_s?: number;
  fps?: number;
  has_audio?: boolean;
  mtime: Date;
}

export async function probeMedia(path: string): Promise<MediaProbe> {
  const [file, mime] = await Promise.all([stat(path), sniffMime(path)]);
  if (mime.startsWith('image/')) {
    const metadata = await sharp(path, { limitInputPixels: 268_435_456 }).metadata();
    return {
      mime,
      bytes: file.size,
      ...(metadata.width === undefined ? {} : { width: metadata.width }),
      ...(metadata.height === undefined ? {} : { height: metadata.height }),
      mtime: file.mtime,
    };
  }
  if (mime.startsWith('video/') || mime.startsWith('audio/')) {
    const result = await runMediaProcess(
      process.env.KILNRY_FFPROBE ?? 'ffprobe',
      ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', path],
      { timeoutMs: 20_000 },
    );
    const parsed = JSON.parse(result.stdout) as {
      format?: { duration?: string };
      streams?: Array<{
        codec_type?: string;
        width?: number;
        height?: number;
        avg_frame_rate?: string;
      }>;
    };
    const video = parsed.streams?.find((stream) => stream.codec_type === 'video');
    const hasAudio = parsed.streams?.some((stream) => stream.codec_type === 'audio') ?? false;
    const [numerator, denominator] = video?.avg_frame_rate?.split('/').map(Number) ?? [];
    const fps = numerator && denominator ? numerator / denominator : undefined;
    return {
      mime,
      bytes: file.size,
      ...(video?.width === undefined ? {} : { width: video.width }),
      ...(video?.height === undefined ? {} : { height: video.height }),
      ...(parsed.format?.duration === undefined ? {} : { duration_s: Number(parsed.format.duration) }),
      ...(fps === undefined ? {} : { fps }),
      has_audio: hasAudio,
      mtime: file.mtime,
    };
  }
  return { mime, bytes: file.size, mtime: file.mtime };
}

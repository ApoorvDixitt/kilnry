// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { mkdir, opendir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { runMediaProcess } from './process.js';

export async function createThumbnail(
  input: string,
  output: string,
  mime: string,
  durationS?: number,
): Promise<{ created: boolean; reason?: string }> {
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  if (mime.startsWith('image/')) {
    await sharp(input, { limitInputPixels: 268_435_456, sequentialRead: true })
      .rotate()
      .resize(320, 320, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(output);
    return { created: true };
  }
  if (mime.startsWith('video/')) {
    const frame = `${output}.png`;
    try {
      await runMediaProcess(
        process.env.KILNRY_FFMPEG ?? 'ffmpeg',
        [
          '-hide_banner',
          '-nostdin',
          '-y',
          '-ss',
          String(Math.max(0.5, (durationS ?? 5) * 0.1)),
          '-i',
          input,
          '-frames:v',
          '1',
          '-vf',
          "scale='min(320,iw)':-2",
          frame,
        ],
        { timeoutMs: 60_000 },
      );
      await sharp(frame).webp({ quality: 82 }).toFile(output);
    } finally {
      await rm(frame, { force: true });
    }
    return { created: true };
  }
  if (mime.startsWith('audio/')) {
    const waveform = `${output}.png`;
    try {
      await runMediaProcess(
        process.env.KILNRY_FFMPEG ?? 'ffmpeg',
        [
          '-hide_banner',
          '-nostdin',
          '-y',
          '-i',
          input,
          '-filter_complex',
          'showwavespic=s=320x80:colors=#007A4B',
          '-frames:v',
          '1',
          waveform,
        ],
        { timeoutMs: 60_000 },
      );
      await sharp(waveform).webp({ quality: 82 }).toFile(output);
    } finally {
      await rm(waveform, { force: true });
    }
    return { created: true };
  }
  return { created: false, reason: `thumbnail_not_implemented:${mime}` };
}

export async function enforceCacheLimit(
  dataDir: string,
  limitBytes = 5 * 1024 * 1024 * 1024,
): Promise<{ removed: number; bytes: number }> {
  const root = join(dataDir, 'cache');
  const files: Array<{ path: string; bytes: number; atime: number }> = [];
  const walk = async (directory: string): Promise<void> => {
    let handle: Awaited<ReturnType<typeof opendir>>;
    try {
      handle = await opendir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for await (const entry of handle) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) {
        const value = await stat(path);
        files.push({ path, bytes: value.size, atime: value.atimeMs || value.mtimeMs });
      }
    }
  };
  await walk(root);
  files.sort((left, right) => left.atime - right.atime);
  let bytes = files.reduce((total, file) => total + file.bytes, 0);
  let removed = 0;
  while (bytes > limitBytes && files.length > 1) {
    const oldest = files.shift()!;
    await rm(oldest.path, { force: true });
    bytes -= oldest.bytes;
    removed += 1;
  }
  return { removed, bytes };
}

export async function createDerivatives(input: {
  source: string;
  dataDir: string;
  assetId: string;
  mime: string;
  durationS?: number;
}): Promise<{
  thumbnail?: string;
  preview?: string;
  sprite?: string;
  adjustments: string[];
}> {
  const adjustments: string[] = [];
  const thumbnail = join(input.dataDir, 'cache', 'thumbs', `${input.assetId}.webp`);
  try {
    const result = await createThumbnail(input.source, thumbnail, input.mime, input.durationS);
    if (!result.created && result.reason) adjustments.push(result.reason);
  } catch (error) {
    adjustments.push(
      `thumbnail_failed:${error instanceof Error ? error.message.slice(0, 120) : String(error)}`,
    );
  }
  if (!input.mime.startsWith('video/')) {
    await enforceCacheLimit(input.dataDir);
    return {
      ...(adjustments.some((value) => value.startsWith('thumbnail_')) ? {} : { thumbnail }),
      adjustments,
    };
  }
  const preview = join(input.dataDir, 'cache', 'previews', `${input.assetId}.mp4`);
  const sprite = join(input.dataDir, 'cache', 'sprites', `${input.assetId}.webp`);
  await Promise.all([
    mkdir(dirname(preview), { recursive: true, mode: 0o700 }),
    mkdir(dirname(sprite), { recursive: true, mode: 0o700 }),
  ]);
  const ffmpeg = process.env.KILNRY_FFMPEG ?? 'ffmpeg';
  try {
    await runMediaProcess(
      ffmpeg,
      [
        '-hide_banner',
        '-nostdin',
        '-y',
        '-i',
        input.source,
        '-t',
        input.durationS !== undefined && input.durationS < 8 ? '5' : '10',
        '-an',
        '-vf',
        "scale=-2:'min(480,ih)',fps=30,format=yuv420p",
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '28',
        '-movflags',
        '+faststart',
        preview,
      ],
      { timeoutMs: 180_000 },
    );
  } catch (error) {
    adjustments.push(
      `preview_failed:${error instanceof Error ? error.message.slice(0, 120) : String(error)}`,
    );
  }
  try {
    const duration = Math.max(input.durationS ?? 1, 1);
    const sheet = `${sprite}.png`;
    let height: number | undefined;
    try {
      await runMediaProcess(
        ffmpeg,
        [
          '-hide_banner',
          '-nostdin',
          '-y',
          '-i',
          input.source,
          '-vf',
          `fps=10/${duration},scale=160:-2,tile=10x1`,
          '-frames:v',
          '1',
          sheet,
        ],
        { timeoutMs: 180_000 },
      );
      height = (await sharp(sheet).metadata()).height;
      await sharp(sheet).webp({ quality: 70 }).toFile(sprite);
    } finally {
      await rm(sheet, { force: true });
    }
    await writeFile(
      `${sprite}.json`,
      `${JSON.stringify({ frames: 10, w: 160, h: height, duration_s: duration }, null, 2)}\n`,
      { mode: 0o600 },
    );
  } catch (error) {
    adjustments.push(`sprite_failed:${error instanceof Error ? error.message.slice(0, 120) : String(error)}`);
  }
  await enforceCacheLimit(input.dataDir);
  return {
    thumbnail,
    ...(adjustments.some((value) => value.startsWith('preview_failed')) ? {} : { preview }),
    ...(adjustments.some((value) => value.startsWith('sprite_failed')) ? {} : { sprite }),
    adjustments,
  };
}

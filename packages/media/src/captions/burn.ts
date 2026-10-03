// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// burn_captions renders a Kilnry transcript into subtitles and burns them into
// the video with libass (TRD-09 §3.6, §4). The .ass file and the bundled fonts
// are Kilnry-owned paths; the filter-option value is escaped. User text reaches
// libass only through the .ass file, never a filtergraph argument.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { probeMedia } from '../probe.js';
import { runMediaProcess } from '../process.js';
import { buildAss, escapeFilterPath, type CaptionLook, type SafeZone } from './ass.js';
import { applyAuthored, buildCues, TranscriptSchema } from './transcript.js';

export interface BurnOptions {
  look?: CaptionLook;
  safeZone?: SafeZone;
  maxWords?: number;
  maxChars?: number;
  caps?: boolean;
}

// The bundled OFL fonts libass finds through fontsdir.
export function fontsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'fonts');
}

// Build the .ass for a transcript and video size. Exposed so a test can assert
// the subtitle content without rendering.
export async function assForVideo(
  video: string,
  transcriptJson: unknown,
  options: BurnOptions = {},
): Promise<string> {
  const transcript = TranscriptSchema.parse(transcriptJson);
  const words = transcript.authored ? applyAuthored(transcript.words, transcript.authored) : transcript.words;
  const cues = buildCues(words, {
    ...(options.maxWords === undefined ? {} : { maxWords: options.maxWords }),
    ...(options.maxChars === undefined ? {} : { maxChars: options.maxChars }),
    ...(options.caps === undefined ? {} : { caps: options.caps }),
  });
  const probe = await probeMedia(video);
  return buildAss(cues, {
    width: probe.width ?? 1080,
    height: probe.height ?? 1920,
    ...(options.look === undefined ? {} : { look: options.look }),
    ...(options.safeZone === undefined ? {} : { safeZone: options.safeZone }),
  });
}

export async function burnCaptions(
  video: string,
  transcriptJson: unknown,
  output: string,
  options: BurnOptions = {},
  ffmpeg = process.env.KILNRY_FFMPEG ?? 'ffmpeg',
): Promise<{ log_tail: string }> {
  const ass = await assForVideo(video, transcriptJson, options);
  const dir = await mkdtemp(join(tmpdir(), 'kilnry-captions-'));
  const assPath = join(dir, 'captions.ass');
  try {
    await writeFile(assPath, ass, 'utf8');
    const filter = `ass=filename=${escapeFilterPath(assPath)}:fontsdir=${escapeFilterPath(fontsDir())}`;
    const result = await runMediaProcess(
      ffmpeg,
      [
        '-hide_banner',
        '-nostdin',
        '-y',
        '-i',
        video,
        '-vf',
        filter,
        '-map',
        '0:v',
        '-map',
        '0:a?',
        '-c:v',
        'libx264',
        '-crf',
        '18',
        '-c:a',
        'copy',
        output,
      ],
      { timeoutMs: 180_000 },
    );
    return { log_tail: `${result.stderr}`.trim().split('\n').slice(-20).join('\n') };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

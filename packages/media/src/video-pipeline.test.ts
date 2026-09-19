// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { embedMetadata, readEmbeddedMetadata, type EmbeddedPayload } from './metadata/index.js';
import { probeMedia } from './probe.js';
import { runMediaProcess } from './process.js';
import { createDerivatives } from './thumbnails.js';

const ffmpeg = process.env.KILNRY_FFMPEG ?? 'ffmpeg';
const ffmpegAvailable = spawnSync(ffmpeg, ['-version'], { stdio: 'ignore' }).status === 0;
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('video metadata and derivatives', () => {
  it.skipIf(!ffmpegAvailable)('remuxes metadata and creates a thumbnail, preview, and sprite', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kilnry-video-'));
    roots.push(root);
    const video = join(root, 'fixture.mp4');
    await runMediaProcess(
      ffmpeg,
      [
        '-hide_banner',
        '-nostdin',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'color=c=#d9c099:s=64x64:d=1:r=10',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        video,
      ],
      { timeoutMs: 30_000 },
    );
    const payload: EmbeddedPayload = {
      kilnry: 1,
      asset_id: '01J00000000000000000000000',
      library_id: '01J00000000000000000000001',
      created_at: '2026-09-19T00:00:00.000Z',
      source: 'ui',
      kind: 'video',
      generation: { prompt: 'a warm paper field', model: 'fixture/video' },
      lineage: { made_from: [] },
    };
    expect(await embedMetadata(video, 'video/mp4', payload)).toEqual({ embedded: true });
    expect((await readEmbeddedMetadata(video, 'video/mp4')).payload).toEqual(payload);
    const probe = await probeMedia(video);
    expect(probe).toMatchObject({ mime: 'video/mp4', width: 64, height: 64 });
    const derivatives = await createDerivatives({
      source: video,
      dataDir: root,
      assetId: payload.asset_id,
      mime: 'video/mp4',
      ...(probe.duration_s === undefined ? {} : { durationS: probe.duration_s }),
    });
    expect(derivatives.adjustments).toEqual([]);
    expect(existsSync(derivatives.thumbnail!)).toBe(true);
    expect(existsSync(derivatives.preview!)).toBe(true);
    expect(existsSync(derivatives.sprite!)).toBe(true);
    expect(existsSync(`${derivatives.sprite}.json`)).toBe(true);
  });
});

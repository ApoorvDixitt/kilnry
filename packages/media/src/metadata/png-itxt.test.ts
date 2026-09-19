// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { embedMetadata, readEmbeddedMetadata, type EmbeddedPayload } from './index.js';
import { readPngMetadata, writePngMetadata } from './png-itxt.js';
import { createThumbnail } from '../thumbnails.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function png(): Promise<Buffer> {
  return sharp({ create: { width: 8, height: 8, channels: 4, background: '#d9c099' } })
    .png()
    .toBuffer();
}

const payload: EmbeddedPayload = {
  kilnry: 1,
  asset_id: '01J00000000000000000000000',
  library_id: '01J00000000000000000000001',
  created_at: '2026-09-19T00:00:00.000Z',
  source: 'ui',
  kind: 'image',
  generation: { prompt: 'a small kiln icon', negative_prompt: null, model: 'fixture/model', seed: 42 },
  lineage: { made_from: [] },
};

describe('PNG iTXt metadata', () => {
  it('round-trips the Kilnry payload and A1111 parameters before IEND', async () => {
    const original = await png();
    const written = writePngMetadata(original, payload, 'a small kiln icon\nSteps: -, Seed: 42');
    expect(readPngMetadata(written)).toEqual({
      payload,
      parameters: 'a small kiln icon\nSteps: -, Seed: 42',
    });
    expect(Buffer.from(written).indexOf(Buffer.from('iTXt'))).toBeLessThan(
      Buffer.from(written).indexOf(Buffer.from('IEND')),
    );
  });

  it('embeds atomically in a file and creates a 320px WebP thumbnail', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kilnry-media-'));
    roots.push(root);
    const input = join(root, 'asset.png');
    const thumbnail = join(root, 'cache', 'thumb.webp');
    writeFileSync(input, await png());
    expect(await embedMetadata(input, 'image/png', payload)).toEqual({ embedded: true });
    expect((await readEmbeddedMetadata(input, 'image/png')).payload).toEqual(payload);
    expect(await createThumbnail(input, thumbnail, 'image/png')).toEqual({ created: true });
    expect(readFileSync(thumbnail).subarray(0, 4).toString('ascii')).toBe('RIFF');
  });
});

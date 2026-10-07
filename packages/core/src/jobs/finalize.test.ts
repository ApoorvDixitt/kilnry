// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// F-78: TRD-20 §2 says an all-black fal output — what the FLUX safety checker
// answers with for a refused prompt — is a MODERATION_REJECTED carrying
// `billed: 'yes'` and the code `black_image`, detected by sharp's stats() mean
// under 2. Nothing looked at a decoded output, so the blanked image was
// finalized as a successful, charged asset and the user paid for a black file
// with no explanation.

import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { firstBlackImage } from './finalize.js';

async function png(colour: { r: number; g: number; b: number }): Promise<Uint8Array> {
  const image = await sharp({
    create: { width: 32, height: 32, channels: 3, background: colour },
  })
    .png()
    .toBuffer();
  return new Uint8Array(image);
}

describe('the all-black output check (F-JOB-04, TRD-20 §2)', () => {
  it('finds a blanked image and leaves a real one alone', async () => {
    const black = await png({ r: 0, g: 0, b: 0 });
    const picture = await png({ r: 140, g: 90, b: 40 });

    expect(await firstBlackImage([{ index: 0, bytes: black, mime: 'image/png' }])).toBe(0);
    expect(await firstBlackImage([{ index: 0, bytes: picture, mime: 'image/png' }])).toBeUndefined();
    // The index reported is the offending output's own.
    expect(
      await firstBlackImage([
        { index: 0, bytes: picture, mime: 'image/png' },
        { index: 1, bytes: black, mime: 'image/png' },
      ]),
    ).toBe(1);
  });

  it('ignores anything that is not an image', async () => {
    expect(
      await firstBlackImage([{ index: 0, bytes: new Uint8Array([0, 0, 0, 0]), mime: 'video/mp4' }]),
    ).toBeUndefined();
    // Near-black but not blank: a dark photograph is not a refusal.
    const dark = await png({ r: 6, g: 6, b: 8 });
    expect(await firstBlackImage([{ index: 0, bytes: dark, mime: 'image/png' }])).toBeUndefined();
  });
});

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it, vi } from 'vitest';
import { downscaleToLongEdge, MAX_IMAGE_EDGE_PX, toFileParts, type AttachedAsset } from './attachments.js';

const image: AttachedAsset = {
  id: '01JIMAGE',
  path: 'inbox/chai_glass.png',
  kind: 'image',
  mime: 'image/png',
};
const video: AttachedAsset = { id: '01JVIDEO', path: 'inbox/reel.mp4', kind: 'video', mime: 'video/mp4' };
const audio: AttachedAsset = { id: '01JAUDIO', path: 'inbox/take.mp3', kind: 'audio', mime: 'audio/mpeg' };

const assets = new Map([image, video, audio].map((asset) => [asset.id, asset] as const));

const base = {
  getAsset: async (id: string) => assets.get(id),
  assetUrl: (id: string) => `http://127.0.0.1:3123/api/media/${id}`,
};

describe('toFileParts (F-CHT-05, TRD-11 §8)', () => {
  it('attaches a Character as a reference, never as pixels', async () => {
    const { parts } = await toFileParts({
      ...base,
      attachments: [{ handle: 'maya' }],
      caps: { vision: true },
    });
    expect(parts).toEqual([
      { type: 'text', text: 'Attached character @maya. Use kilnry_characters get for details.' },
    ]);
  });

  it('sends an image by loopback url and names its id and path', async () => {
    const { parts } = await toFileParts({
      ...base,
      attachments: [{ asset_id: image.id }],
      caps: { vision: true },
    });
    expect(parts[0]).toEqual({
      type: 'file',
      mediaType: 'image/png',
      url: 'http://127.0.0.1:3123/api/media/01JIMAGE',
    });
    expect(parts[1]).toEqual({ type: 'text', text: 'asset_id=01JIMAGE path=inbox/chai_glass.png' });
  });

  it('sends bytes rather than a url to a local model', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const { parts } = await toFileParts({
      ...base,
      attachments: [{ asset_id: image.id }],
      caps: { vision: true, local: true },
      readBytes: async () => bytes,
    });
    expect(parts[0]).toEqual({ type: 'file', mediaType: 'image/png', data: bytes });
  });

  it('sends a video only when the model takes video in', async () => {
    const withVideo = await toFileParts({
      ...base,
      attachments: [{ asset_id: video.id }],
      caps: { vision: true, video_in: true },
    });
    expect(withVideo.parts[0]).toMatchObject({ type: 'file', mediaType: 'video/mp4' });

    const analyse = vi.fn(async () => ({ text: 'A glass of chai on a counter.', cost_usd: 0.004 }));
    const withoutVideo = await toFileParts({
      ...base,
      attachments: [{ asset_id: video.id }],
      caps: { vision: true },
      analyse,
    });
    expect(analyse).toHaveBeenCalledWith({ task: 'describe', asset_id: '01JVIDEO' });
    expect(withoutVideo.parts[0]).toEqual({
      type: 'text',
      text: 'Attachment inbox/reel.mp4 (video): A glass of chai on a counter.',
    });
  });

  it('transcribes audio and says what the analysis cost', async () => {
    const analyse = vi.fn(async () => ({ text: 'Morning, everyone.', cost_usd: 0.01 }));
    const { parts, notes } = await toFileParts({
      ...base,
      attachments: [{ asset_id: audio.id }],
      caps: { vision: true },
      analyse,
    });
    expect(analyse).toHaveBeenCalledWith({ task: 'transcribe_local', asset_id: '01JAUDIO' });
    expect(parts[0]).toEqual({
      type: 'text',
      text: 'Attachment inbox/take.mp3 (audio): Morning, everyone.',
    });
    expect(notes).toEqual(['Analysed inbox/take.mp3 for $0.01.']);
  });

  it('describes an image for a model that cannot see', async () => {
    const analyse = vi.fn(async () => ({ text: 'A kraft pouch.', cost_usd: 0 }));
    const { parts, notes } = await toFileParts({
      ...base,
      attachments: [{ asset_id: image.id }],
      caps: { vision: false },
      analyse,
    });
    expect(analyse).toHaveBeenCalledWith({ task: 'describe', asset_id: '01JIMAGE' });
    expect(parts[0]).toMatchObject({ type: 'text' });
    expect(notes).toEqual(['Analysed inbox/chai_glass.png.']);
  });

  it('says plainly that it cannot see a file when nothing can analyse it', async () => {
    const { parts, notes } = await toFileParts({
      ...base,
      attachments: [{ asset_id: image.id }],
      caps: { vision: false },
    });
    expect(parts[0]).toEqual({
      type: 'text',
      text: 'Attachment inbox/chai_glass.png (image); you cannot see it.',
    });
    expect(notes).toEqual(['You cannot see inbox/chai_glass.png in this session.']);
  });

  it('reports an attachment that is no longer in the Library', async () => {
    const { parts, notes } = await toFileParts({
      ...base,
      attachments: [{ asset_id: 'gone' }],
      caps: { vision: true },
    });
    expect(parts).toEqual([]);
    expect(notes).toEqual(['That attachment is no longer in the Library (gone).']);
  });

  it('keeps several attachments in the order they were added', async () => {
    const { parts } = await toFileParts({
      ...base,
      attachments: [{ handle: 'maya' }, { asset_id: image.id }],
      caps: { vision: true },
    });
    expect(parts).toHaveLength(3);
    expect(parts[0]).toMatchObject({ type: 'text' });
    expect(parts[1]).toMatchObject({ type: 'file' });
  });
});

describe('downscaleToLongEdge (F-CHT-10)', () => {
  it('caps the long edge and keeps the shape', () => {
    expect(downscaleToLongEdge(4000, 2000)).toEqual({ width: MAX_IMAGE_EDGE_PX, height: 784 });
    expect(downscaleToLongEdge(2000, 4000)).toEqual({ width: 784, height: MAX_IMAGE_EDGE_PX });
  });

  it('leaves an already small image alone', () => {
    expect(downscaleToLongEdge(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import {
  editCapabilityFor,
  editModeForKind,
  editPayload,
  editSourceFromDetail,
  filenameOf,
} from './edit-logic';

describe('edit-logic (F-CRE-10)', () => {
  it('reads the filename from a Library path', () => {
    expect(filenameOf('inbox/serum_hero.png')).toBe('serum_hero.png');
    expect(filenameOf('clip_01.mp4')).toBe('clip_01.mp4');
  });

  it('builds an edit source only for image and video assets', () => {
    expect(editSourceFromDetail({ id: 'a1', path: 'inbox/serum_hero.png', kind: 'image' })).toEqual({
      asset_id: 'a1',
      kind: 'image',
      file: 'serum_hero.png',
    });
    expect(editSourceFromDetail({ id: 'v1', path: 'clip_01.mp4', kind: 'video' })).toEqual({
      asset_id: 'v1',
      kind: 'video',
      file: 'clip_01.mp4',
    });
    expect(editSourceFromDetail({ id: 't1', path: 'notes.txt', kind: 'text' })).toBeNull();
  });

  it('switches the composer mode to match the source kind (AC 1)', () => {
    expect(editModeForKind('image')).toBe('image');
    expect(editModeForKind('video')).toBe('video');
  });

  it('routes to image_edit or video2video, never text2image (AC 2)', () => {
    expect(editCapabilityFor('image')).toBe('image_edit');
    expect(editCapabilityFor('video')).toBe('video2video');
  });

  it('records the source in medias[] with role source and the edit kind', () => {
    const source = { asset_id: 'a1', kind: 'image' as const, file: 'serum_hero.png' };
    const payload = editPayload(source, {
      prompt: 'Replace the background with a Goa beach at golden hour. Keep the bottle exactly.',
      model: 'auto',
      params: { aspect_ratio: '1:1' },
    });
    expect(payload.kind).toBe('image_edit');
    expect(payload.capability).toBe('image_edit');
    expect(payload.medias).toEqual([{ role: 'source', asset_id: 'a1' }]);
    expect(payload.params).toMatchObject({ quality: 'standard', aspect_ratio: '1:1' });
    expect(payload.count).toBe(1);
  });

  it('routes a video source to video_edit with the video2video capability', () => {
    const source = { asset_id: 'v1', kind: 'video' as const, file: 'clip_01.mp4' };
    const payload = editPayload(source, {
      prompt: 'Make the jacket deep red; keep everything else identical.',
      model: 'auto',
      params: {},
    });
    expect(payload.kind).toBe('video_edit');
    expect(payload.capability).toBe('video2video');
    expect(payload.medias[0]?.role).toBe('source');
  });
});

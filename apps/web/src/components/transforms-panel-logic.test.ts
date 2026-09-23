// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { TRANSFORM_TABS, canRun, lipsyncBilledSeconds, tabFor } from './transforms-panel-logic';

describe('transforms panel logic (F-CRE-11)', () => {
  it('offers every operation in order and marks them all available', () => {
    expect(TRANSFORM_TABS.map((tab) => tab.op)).toEqual([
      'upscale_image',
      'upscale_video',
      'bg_remove',
      'reframe',
      'outpaint',
      'lipsync',
      'dubbing',
      'voice_change',
      'transcribe',
    ]);
    expect(tabFor('dubbing').available).toBe(true);
    expect(tabFor('voice_change').available).toBe(true);
    expect(tabFor('lipsync').available).toBe(true);
  });

  it('disables Run until the source and required inputs are present', () => {
    // Upscale needs only a source.
    expect(canRun({ op: 'upscale_image', source: '', params: {}, running: false })).toBe(false);
    expect(canRun({ op: 'upscale_image', source: 'a1', params: {}, running: false })).toBe(true);
    // Reframe needs an aspect ratio.
    expect(canRun({ op: 'reframe', source: 'a1', params: {}, running: false })).toBe(false);
    expect(canRun({ op: 'reframe', source: 'a1', params: { aspect_ratio: '9:16' }, running: false })).toBe(
      true,
    );
    // Lip-sync needs audio.
    expect(canRun({ op: 'lipsync', source: 'a1', params: {}, running: false })).toBe(false);
    expect(canRun({ op: 'lipsync', source: 'a1', params: { audio: '@maya hi' }, running: false })).toBe(true);
    // Dubbing needs a language; voice change needs a voice.
    expect(canRun({ op: 'dubbing', source: 'a1', params: {}, running: false })).toBe(false);
    expect(canRun({ op: 'dubbing', source: 'a1', params: { language: 'es' }, running: false })).toBe(true);
    expect(canRun({ op: 'voice_change', source: 'a1', params: {}, running: false })).toBe(false);
    expect(canRun({ op: 'voice_change', source: 'a1', params: { voice: '@maya' }, running: false })).toBe(
      true,
    );
    // Running blocks Run.
    expect(canRun({ op: 'upscale_image', source: 'a1', params: {}, running: true })).toBe(false);
  });

  it('rounds lip-sync billing up to five-second steps', () => {
    expect(lipsyncBilledSeconds(0)).toBe(0);
    expect(lipsyncBilledSeconds(1)).toBe(5);
    expect(lipsyncBilledSeconds(5)).toBe(5);
    expect(lipsyncBilledSeconds(12)).toBe(15);
  });
});

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { CanonicalRequestSchema } from '../types.js';
import { registrySeed, seedSnapshotMap } from './seed/index.js';
import { route } from './router.js';

const providers = {
  fal: { connected: true, status: 'ok' as const },
  openrouter: { connected: true, status: 'ok' as const },
  pollinations: { connected: false, status: 'not_connected' as const },
};

describe('Auto router', () => {
  it('picks the cheapest connected image route deterministically', () => {
    const request = CanonicalRequestSchema.parse({
      kind: 'image',
      capability: 'text2image',
      prompt: 'kiln icon',
      params: { width: 1000, height: 1000, quality: 'draft' },
      medias: [],
      injections: [],
      count: 1,
      target_folder: 'inbox',
      source: 'ui',
    });
    const first = route(
      request,
      { quality: 'draft' },
      { models: [...registrySeed], snapshots: seedSnapshotMap(), providers },
    );
    const second = route(
      request,
      { quality: 'draft' },
      { models: [...registrySeed], snapshots: seedSnapshotMap(), providers },
    );
    expect(first.model_id).toBe('fal-ai/flux-2/klein/4b');
    expect(second).toEqual(first);
    expect(first.why).toMatch(/Auto picked.+fal/i);
    expect(first.why.length).toBeLessThanOrEqual(160);
  });

  it('routes Seedance 2.5 through OpenRouter and never through fal', () => {
    const request = CanonicalRequestSchema.parse({
      kind: 'video',
      capability: 'reference2video',
      prompt: 'reference clip',
      params: { resolution: '480p', duration_s: 5, audio: true },
      medias: [{ role: 'reference', asset_id: '01J00000000000000000000000' }],
      injections: [],
      count: 1,
      target_folder: 'inbox',
      source: 'ui',
    });
    const result = route(
      request,
      { needs_audio: true, refs_count: 20, refs_kinds: ['image'], min_resolution: '480p' },
      { models: [...registrySeed], snapshots: seedSnapshotMap(), providers },
    );
    expect(result.provider).toBe('openrouter');
    expect(result.model_id).toBe('bytedance/seedance-2.5');
    expect(result.model_id).not.toMatch(/sora|gemini-2\.5-flash-image/i);
  });

  it('skips disconnected and actively degraded providers', () => {
    const request = CanonicalRequestSchema.parse({
      kind: 'image',
      capability: 'text2image',
      prompt: 'kiln icon',
      params: { width: 1000, height: 1000, quality: 'draft' },
      medias: [],
      injections: [],
      count: 1,
      target_folder: 'inbox',
      source: 'ui',
    });
    const result = route(
      request,
      { quality: 'draft' },
      {
        models: [...registrySeed],
        snapshots: seedSnapshotMap(),
        providers: {
          ...providers,
          fal: { connected: true, status: 'degraded', degraded_until: new Date(Date.now() + 60_000) },
        },
      },
    );
    expect(result.provider).toBe('openrouter');
  });

  it('rejects a pinned model that violates D-42', () => {
    const request = CanonicalRequestSchema.parse({
      kind: 'video',
      capability: 'text2video',
      prompt: 'clip',
      params: { resolution: '480p', duration_s: 5 },
      medias: [],
      injections: [],
      count: 1,
      target_folder: 'inbox',
      source: 'ui',
    });
    expect(() =>
      route(
        request,
        { pinned_model: 'bytedance/seedance-2.5/text-to-video' },
        { models: [...registrySeed], snapshots: seedSnapshotMap(), providers },
      ),
    ).toThrow(/Seedance 2\.5/i);
  });
});

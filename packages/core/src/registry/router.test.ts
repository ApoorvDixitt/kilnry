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

// F-119: these fal endpoints require an image input — start_image_url on Kling
// v3 and Wan 3.0 image-to-video, image_url on Seedance and Veo 3.1
// image-to-video, image_urls on Veo 3.1 reference-to-video
// (https://fal.ai/models/<id>/llms.txt, read 2026-10-06). A text-only request
// routed to one is rejected by fal after Kilnry quoted its price.
const REQUIRES_IMAGE = [
  'fal-ai/kling-video/v3/standard/image-to-video',
  'fal-ai/kling-video/v3/pro/image-to-video',
  'alibaba/wan-3.0/image-to-video',
  'bytedance/seedance-2.0/image-to-video',
  'bytedance/seedance-2.5/image-to-video',
  'fal-ai/veo3.1/image-to-video',
  'fal-ai/veo3.1/fast/image-to-video',
  'fal-ai/veo3.1/lite/image-to-video',
  'fal-ai/veo3.1/reference-to-video',
];

describe('a text-only video request (F-119)', () => {
  const request = CanonicalRequestSchema.parse({
    kind: 'video',
    capability: 'text2video',
    prompt: 'slow dolly on a chai glass, steam',
    params: { resolution: '720p', duration_s: 5 },
    medias: [],
    injections: [],
    count: 1,
    target_folder: 'inbox',
    source: 'ui',
  });

  it('is routed to an endpoint that takes a prompt alone, never one that requires an image', () => {
    const falOnly = { fal: { connected: true, status: 'ok' as const } };
    const result = route(
      request,
      {},
      { models: [...registrySeed], snapshots: seedSnapshotMap(), providers: falOnly },
    );
    expect(REQUIRES_IMAGE).not.toContain(result.model_id);
    for (const alternate of result.alternates) expect(REQUIRES_IMAGE).not.toContain(alternate.model_id);
  });

  it('can never be routed to one of them: no image-required endpoint carries text2video', () => {
    // The router only considers rows whose capabilities include the request's,
    // so this covers every candidate, not just the ones it ranks first.
    for (const id of REQUIRES_IMAGE) {
      const row = registrySeed.find((model) => model.model_id === id);
      expect(row, id).toBeDefined();
      expect(row?.capabilities, id).not.toContain('text2video');
    }
    for (const id of ['alibaba/wan-3.0/text-to-video', 'fal-ai/kling-video/v3/standard/text-to-video']) {
      expect(registrySeed.find((model) => model.model_id === id)?.capabilities, id).toEqual(['text2video']);
    }
  });
});

// D-72: a video that carries a Character or an Element must reach an endpoint
// that has a field for it. fal's prompt-only video endpoints have no elements,
// reference or frame field at all (every `*/text-to-video` page and the bare
// `fal-ai/veo3.1` rows, read 2026-10-06), so the identity would be dropped and
// the video paid for.
describe('a video that mentions a Character (D-72)', () => {
  const falOnly = { fal: { connected: true, status: 'ok' as const } };
  const context = () => ({
    models: [...registrySeed],
    snapshots: seedSnapshotMap(),
    providers: falOnly,
  });
  const video = (medias: Array<Record<string, unknown>>) =>
    CanonicalRequestSchema.parse({
      kind: 'video',
      capability: 'text2video',
      prompt: 'Slow dolly-in on @maya at a chai stall',
      params: { resolution: '720p', duration_s: 5 },
      medias,
      injections: [],
      count: 1,
      target_folder: 'inbox',
      source: 'ui',
    });

  it('with no first frame is served as reference-to-video, never by a prompt-only endpoint', () => {
    const result = route(video([]), { identity_mention: true }, context());
    const picked = registrySeed.find((model) => model.model_id === result.model_id)!;
    expect(picked.capabilities).toContain('reference2video');
    expect(picked.supports.references_max).toBeGreaterThan(0);
    // And no endpoint it could pick requires a first frame.
    for (const id of [result.model_id, ...result.alternates.map((alternate) => alternate.model_id)]) {
      const row = registrySeed.find((model) => model.model_id === id)!;
      expect(
        row.media_roles.some((role) => role.role === 'start_frame' && (role.min ?? 0) >= 1),
        id,
      ).toBe(false);
    }
  });

  it('with a first frame is served as image-to-video, with the elements endpoint first', () => {
    const result = route(
      video([{ role: 'start_frame', asset_id: '01JAK7ANCH0000000000000000' }]),
      { identity_mention: true },
      context(),
    );
    const picked = registrySeed.find((model) => model.model_id === result.model_id)!;
    expect(picked.capabilities).toEqual(['image2video']);
    expect(picked.supports.elements).toBe(true);
    expect(result.model_id).toBe('fal-ai/kling-video/v3/standard/image-to-video');
  });

  it('is unchanged when the user pinned a model: the resolver, not the router, tells them', () => {
    const result = route(
      video([]),
      { identity_mention: true, pinned_model: 'fal-ai/kling-video/v3/pro/text-to-video' },
      context(),
    );
    expect(result.model_id).toBe('fal-ai/kling-video/v3/pro/text-to-video');
  });

  it('no endpoint that requires a first frame claims reference2video', () => {
    for (const model of registrySeed) {
      if (!model.media_roles.some((role) => role.role === 'start_frame' && (role.min ?? 0) >= 1)) continue;
      expect(model.capabilities, model.model_id).not.toContain('reference2video');
      expect(model.capabilities, model.model_id).not.toContain('text2video');
    }
  });

  it('the Kling v3 text-to-video rows claim no identity slot at all', () => {
    for (const id of [
      'fal-ai/kling-video/v3/standard/text-to-video',
      'fal-ai/kling-video/v3/pro/text-to-video',
    ]) {
      const row = registrySeed.find((model) => model.model_id === id)!;
      expect(row.capabilities, id).toEqual(['text2video']);
      expect(row.supports.elements, id).toBe(false);
      expect(row.supports.references_max, id).toBe(0);
      expect(row.supports.start_end_frame, id).toBe(false);
      expect(row.media_roles, id).toEqual([]);
    }
    for (const id of [
      'fal-ai/kling-video/v3/standard/image-to-video',
      'fal-ai/kling-video/v3/pro/image-to-video',
    ]) {
      const row = registrySeed.find((model) => model.model_id === id)!;
      expect(row.supports.elements, id).toBe(true);
      expect(row.supports.references_max, id).toBe(4);
      expect(row.media_roles.find((role) => role.role === 'start_frame')?.min, id).toBe(1);
    }
  });
});

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { CanonicalRequestSchema, type CanonicalRequest } from '../types.js';
import { ModelManifestSchema, type ModelManifest } from '../registry/manifest.js';
import type { CharacterHead, LoadedVersion } from './store.js';
import type { ResolverCtx, TrainedIdentityInfo } from './resolver-types.js';
import { resolvePrompt } from './resolve.js';

// ── Asset ids (ULID-shaped) and the URL scheme ────────────────────────────────
const ANCH = '01JAK7ANCH0000000000000000';
const TQL = '01JAK73QL00000000000000000';
const PROL = '01JAK7PROL0000000000000000';
const FULL = '01JAK7FULL0000000000000000';
const WET = '01JAK7WET00000000000000000';
const GLAS = '01JAK7GLAS0000000000000000';
const BOARD = '01JAK7BOARD000000000000000';
const JACKET = '01JAK7JACKET00000000000000';
const COUNTER = '01JAK7COUNTER0000000000000';
const ANCH1 = '01JAK7ANCH1000000000000000';

const url = (id: string): string => `https://v3b.fal.media/files/kilnry/${id}.png`;

const MAYA_ID = '01JAK7MAYA0000000000000000';
const CHAI_ID = '01JAK7CHAI0000000000000000';

// ── Character heads and versions ──────────────────────────────────────────────
function head(id: string, handle: string, kind: CharacterHead['kind'], version: number): CharacterHead {
  return {
    id,
    handle,
    kind,
    display_name: handle === 'maya' ? 'Maya' : handle === 'chai_glass' ? 'chai_glass' : handle,
    current_version: version,
    is_real_person: false,
    consent_status: 'n/a',
  };
}

const mayaHead = head(MAYA_ID, 'maya', 'character', 2);
const chaiHead = head(CHAI_ID, 'chai_glass', 'prop', 1);

const mayaAppearance = {
  descriptor:
    'A woman in her early thirties, medium-brown skin, dark chin-length bob with a blunt fringe, small scar on the left side of the chin, gold hoop earrings, navy linen kurta.',
  anchors: ['blunt fringe bob', 'chin scar', 'gold hoops', 'navy kurta'],
  negative_traits: ['glasses', 'beard'],
  gendered_noun: 'woman' as const,
};

function mayaVersion(version: number, references: LoadedVersion['references']): LoadedVersion {
  return {
    id: MAYA_ID,
    handle: 'maya',
    kind: 'character',
    display_name: 'Maya',
    version,
    is_real_person: false,
    consent_status: 'n/a',
    appearance: mayaAppearance,
    references,
    frozen: version === 1,
    voice: { provider: 'fal-kling', voice_id: 'kv_8f2c…' },
  };
}

const mayaV2Refs: LoadedVersion['references'] = [
  { id: 'r-anch', asset_id: ANCH, role: 'anchor', view: 'front', weight: 1, position: 0 },
  { id: 'r-3ql', asset_id: TQL, role: 'turnaround', view: 'three_quarter_left', weight: 1, position: 1 },
  { id: 'r-prol', asset_id: PROL, role: 'turnaround', view: 'profile_left', weight: 1, position: 2 },
  { id: 'r-full', asset_id: FULL, role: 'full_body', view: 'full_body', weight: 1, position: 3 },
  { id: 'r-wet', asset_id: WET, role: 'outfit', label: 'wet', weight: 1, position: 4 },
];

const mayaV1Refs: LoadedVersion['references'] = [
  { id: 'r-anch1', asset_id: ANCH1, role: 'anchor', view: 'front', weight: 1, position: 0 },
];

const chaiVersion: LoadedVersion = {
  id: CHAI_ID,
  handle: 'chai_glass',
  kind: 'prop',
  display_name: 'chai_glass',
  version: 1,
  is_real_person: false,
  consent_status: 'n/a',
  appearance: { descriptor: 'tall cutting-chai glass with a gold rim.', anchors: [], negative_traits: [] },
  references: [{ id: 'r-glas', asset_id: GLAS, role: 'anchor', view: 'front', weight: 1, position: 0 }],
  frozen: false,
};

const mayaIdentities: TrainedIdentityInfo[] = [
  {
    provider: 'fal',
    kind: 'lora',
    status: 'ready',
    base_model: 'flux1-dev',
    trigger_word: 'mayak',
    default_scale: 0.85,
    artifact_url: 'https://v3b.fal.media/files/kilnry/lora.safetensors',
    local_path: '~/.kilnry/identities/01JAK7MAYA/2/fal/lora.safetensors',
  },
  { provider: 'higgsfield', kind: 'soul_id', status: 'ready', remote_id: 'cr_9d2e…' },
];

function makeCtx(overrides: Partial<ResolverCtx> = {}): ResolverCtx {
  const heads: Record<string, CharacterHead> = {
    maya: mayaHead,
    chai_glass: chaiHead,
    [MAYA_ID]: mayaHead,
    [CHAI_ID]: chaiHead,
  };
  return {
    lookupHandle: (h) => heads[h.toLowerCase()],
    loadVersion: (id, version) => {
      if (id === MAYA_ID) return version === 1 ? mayaVersion(1, mayaV1Refs) : mayaVersion(2, mayaV2Refs);
      if (id === CHAI_ID) return chaiVersion;
      throw new Error(`unknown version ${id}`);
    },
    identitiesFor: (id) => (id === MAYA_ID ? mayaIdentities : []),
    assetUrl: url,
    knownHandles: ['maya', 'chai_glass'],
    ...overrides,
  };
}

function req(partial: Partial<CanonicalRequest> & { prompt: string }): CanonicalRequest {
  return CanonicalRequestSchema.parse({
    kind: 'image',
    capability: 'text2image',
    ...partial,
  });
}

// ── Minimal ModelManifest fixtures ────────────────────────────────────────────
function manifest(over: {
  model_id: string;
  provider: ModelManifest['provider'];
  capabilities: ModelManifest['capabilities'];
  supports: Partial<ModelManifest['supports']>;
  media_roles?: ModelManifest['media_roles'];
}): ModelManifest {
  return ModelManifestSchema.parse({
    provider: over.provider,
    model_id: over.model_id,
    display_name: over.model_id,
    capabilities: over.capabilities,
    supports: over.supports,
    media_roles: over.media_roles ?? [],
    price_rule: { kind: 'free', unit: 'image' },
    retention_days: 7,
    moderation: { http: null, shape: 'none', billed: 'no' },
    quality_tier: 'standard',
    source_url: 'https://example.com/model',
    seeded_at: '2026-01-01T00:00:00.000Z',
  });
}

const klingV3Pro = manifest({
  model_id: 'fal-ai/kling-video/v3/pro/image-to-video',
  provider: 'fal',
  capabilities: ['image2video'],
  supports: {
    elements: true,
    references_max: 4,
    voice_ids: true,
    negative_prompt: true,
    start_end_frame: true,
  },
});

const seedance = manifest({
  model_id: 'bytedance/seedance-2.5',
  provider: 'openrouter',
  capabilities: ['text2video', 'reference2video'],
  supports: { elements: false, references_max: 50 },
  media_roles: [{ role: 'reference', min: 0, max: 50, kinds: ['image'] }],
});

const fluxLora = manifest({
  model_id: 'fal-ai/flux-lora',
  provider: 'fal',
  capabilities: ['text2image'],
  supports: { lora: true, references_max: 0 },
});

const soulCharacter = manifest({
  model_id: 'higgsfield-ai/soul/character',
  provider: 'higgsfield',
  capabilities: ['text2image'],
  supports: { identity_ids: ['higgsfield_soul_id'], references_max: 1 },
});

const gptImage = manifest({
  model_id: 'gpt-image-2.5-sunburst',
  provider: 'openai',
  capabilities: ['image_edit'],
  supports: { references_max: 16 },
  media_roles: [{ role: 'reference', min: 0, max: 16, kinds: ['image'] }],
});

const soulStandard = manifest({
  model_id: 'higgsfield-ai/soul/v2/standard',
  provider: 'higgsfield',
  capabilities: ['text2image'],
  supports: { references_max: 0, lora: false, identity_ids: [], negative_prompt: false },
});

const nanoBanana = manifest({
  model_id: 'nano-banana-pro',
  provider: 'google',
  capabilities: ['image_edit'],
  supports: { references_max: 14 },
});

// ── Examples ──────────────────────────────────────────────────────────────────
describe('resolvePrompt §7 worked examples', () => {
  it('Example 1 — fal Kling v3 Pro I2V, elements + voice', () => {
    const r = resolvePrompt(
      req({
        kind: 'video',
        capability: 'image2video',
        prompt:
          'Slow dolly-in on @maya lifting @chai_glass, steam rising. @maya says: "Aaj ki subah, ek kadak chai."',
        negative_prompt: 'blur, distort, and low quality',
        medias: [{ role: 'start_frame', asset_id: COUNTER }],
        params: { duration_s: 5, audio: true },
      }),
      klingV3Pro,
      makeCtx(),
    );

    expect(r.prompt).toBe(
      'Slow dolly-in on @Element1 lifting @Element2 (appearance reference only; ignore its background and lighting), steam rising. @Element1 says <<<voice_1>>>: "Aaj ki subah, ek kadak chai."',
    );
    expect(r.negative_prompt).toBe('blur, distort, and low quality, glasses, beard');
    expect(r.provider_fragment.elements).toEqual([
      { frontal_image_url: url(ANCH), reference_image_urls: [url(TQL), url(PROL)] },
      { frontal_image_url: url(GLAS), reference_image_urls: [] },
    ]);
    expect(r.provider_fragment.voice_ids).toEqual(['kv_8f2c…']);

    expect(r.injections[0]).toMatchObject({
      handle: 'maya',
      version: 2,
      strategy: 'elements',
      slot_index: 1,
    });
    expect(r.injections[0]!.inputs.map((i) => i.asset_id)).toEqual([ANCH, TQL, PROL]);
    expect(r.injections[1]).toMatchObject({
      handle: 'chai_glass',
      version: 1,
      strategy: 'elements',
      slot_index: 2,
    });
    expect(r.injections[1]!.inputs.map((i) => i.asset_id)).toEqual([GLAS]);
    expect(r.injections[2]).toMatchObject({
      handle: 'maya',
      strategy: 'voice_id',
      voice: { provider: 'fal-kling', voice_id: 'kv_8f2c…' },
    });
    expect(r.warnings).toEqual([]);
  });

  it('Example 2 — OpenRouter Seedance 2.5, ordered input_references', () => {
    const r = resolvePrompt(
      req({
        kind: 'video',
        capability: 'reference2video',
        prompt: '@maya hands @chai_glass to a customer, handheld, morning light',
        medias: [{ role: 'reference', asset_id: BOARD, label: 'storyboard' }],
        params: { duration_s: 8, audio: true, resolution: '480p' },
      }),
      seedance,
      makeCtx(),
    );

    expect(r.prompt).toBe(
      "the woman in image 2 (Maya: blunt fringe bob, chin scar, gold hoops) hands the glass in image 4 (appearance reference only; ignore its background and lighting) to a customer, handheld, morning light. Compose from the storyboard in image 1. Keep the woman's face identical to images 2\u20133.",
    );
    expect(r.provider_fragment.input_references).toEqual([
      { url: url(BOARD) },
      { url: url(ANCH) },
      { url: url(TQL) },
      { url: url(GLAS) },
    ]);
    expect(r.warnings).toEqual([]);
  });

  it('Example 3 — fal flux-lora with the trained LoRA', () => {
    const r = resolvePrompt(
      req({
        kind: 'image',
        capability: 'text2image',
        prompt: 'editorial portrait of @maya on a rooftop at dusk, 85mm',
        params: { aspect_ratio: '3:4' },
      }),
      fluxLora,
      makeCtx(),
    );

    expect(r.prompt).toBe(
      'editorial portrait of mayak, blunt fringe bob, chin scar, gold hoops, navy kurta, on a rooftop at dusk, 85mm',
    );
    expect(r.provider_fragment.loras).toEqual([
      { path: 'https://v3b.fal.media/files/kilnry/lora.safetensors', scale: 0.85 },
    ]);
    expect(r.injections[0]).toMatchObject({
      strategy: 'lora',
      lora: {
        path: 'https://v3b.fal.media/files/kilnry/lora.safetensors',
        scale: 0.85,
        trigger_word: 'mayak',
        base_model: 'flux1-dev',
      },
    });
    expect(r.injections[0]!.inputs).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('Example 4 — Higgsfield soul/character with Soul ID', () => {
    const r = resolvePrompt(
      req({
        kind: 'image',
        capability: 'text2image',
        prompt: '@maya at a Mumbai chai stall at dawn, candid, 35mm, film grain',
        params: { aspect_ratio: '9:16', resolution: '1080p' },
      }),
      soulCharacter,
      makeCtx(),
    );

    expect(r.prompt).toBe(
      'A woman in her early thirties, medium-brown skin, dark chin-length bob with a blunt fringe, small scar on the left side of the chin, gold hoop earrings, navy linen kurta, at a Mumbai chai stall at dawn, candid, 35mm, film grain',
    );
    expect(r.provider_fragment.custom_reference_id).toBe('cr_9d2e…');
    expect(r.provider_fragment.custom_reference_strength).toBe(0.8);
    expect(r.provider_fragment.image_reference_url).toBe(url(ANCH));
    expect(r.injections[0]).toMatchObject({
      strategy: 'identity_id',
      identity: { provider: 'higgsfield', remote_id: 'cr_9d2e…', strength: 0.8 },
    });
    expect(r.warnings).toEqual([]);
  });

  it('Example 5 — gpt-image edit, pinned version @maya@v1', () => {
    const r = resolvePrompt(
      req({
        kind: 'image_edit',
        capability: 'image_edit',
        prompt: 'put @maya@v1 in the jacket from the second image, keep everything else',
        medias: [{ role: 'reference', asset_id: JACKET, label: 'jacket' }],
      }),
      gptImage,
      makeCtx(),
    );

    expect(r.prompt).toBe(
      'Edit image 1 so the person in image 1 (Maya: blunt fringe bob, chin scar, gold hoops) wears the jacket from image 2. Keep face, hair, pose, camera and background unchanged. Appearance reference only for image 2; ignore its background and lighting.',
    );
    expect(r.injections[0]).toMatchObject({
      handle: 'maya',
      version: 1,
      strategy: 'reference_images',
      slot_index: 1,
      notes: ['pinned to v1 by @maya@v1'],
    });
    expect(r.injections[0]!.inputs).toEqual([{ role: 'reference', asset_id: ANCH1, view: 'front' }]);
    expect(r.warnings).toEqual([]);
  });

  it('Example 6 — text fallback on Higgsfield soul/v2/standard', () => {
    const r = resolvePrompt(
      req({
        kind: 'image',
        capability: 'text2image',
        prompt: '@maya, fashion editorial, seamless grey, harsh flash',
        params: { aspect_ratio: '3:4', resolution: '1080p' },
      }),
      soulStandard,
      makeCtx(),
    );

    expect(r.prompt).toBe(
      'A woman in her early thirties, medium-brown skin, dark chin-length bob with a blunt fringe, small scar on the left side of the chin, gold hoop earrings, navy linen kurta. Keep: blunt fringe bob, chin scar, gold hoops, navy kurta. Fashion editorial, seamless grey, harsh flash. Avoid: glasses, beard.',
    );
    expect(r.injections[0]).toMatchObject({
      strategy: 'text',
      inputs: [],
      notes: [
        'Soul 2 standard has no reference slot; identity is text-only. Train a Soul ID ($2.50) for a locked face.',
      ],
    });
    expect(r.warnings).toEqual([]);
  });
});

describe('resolvePrompt §5 short examples', () => {
  it('Nano Banana Pro edit appends the identity keep-clause', () => {
    const r = resolvePrompt(
      req({
        kind: 'image_edit',
        capability: 'image_edit',
        prompt: '@maya laughing at a Mumbai chai stall',
      }),
      nanoBanana,
      makeCtx(),
    );
    expect(r.prompt).toBe(
      'the woman in image 1 (Maya: blunt fringe bob, chin scar, gold hoops) laughing at a Mumbai chai stall. Keep her face and hair identical to image 1.',
    );
  });
});

describe('F-CHR-13 people warnings', () => {
  const rohanHead = head('01JAK7ROHAN000000000000000', 'rohan', 'character', 1);
  const rohanV1: LoadedVersion = {
    id: '01JAK7ROHAN000000000000000',
    handle: 'rohan',
    kind: 'character',
    display_name: 'Rohan',
    version: 1,
    is_real_person: false,
    consent_status: 'n/a',
    appearance: {
      descriptor: 'A man with a grey beard.',
      anchors: ['grey beard', 'round glasses'],
      negative_traits: [],
      gendered_noun: 'man',
    },
    references: [
      {
        id: 'r-rohan',
        asset_id: '01JAK7ROHANANCH00000000000',
        role: 'anchor',
        view: 'front',
        weight: 1,
        position: 0,
      },
    ],
    frozen: false,
  };

  function multiCtx(): ResolverCtx {
    const base = makeCtx();
    const heads: Record<string, CharacterHead> = {
      maya: mayaHead,
      chai_glass: chaiHead,
      rohan: rohanHead,
      [MAYA_ID]: mayaHead,
      [CHAI_ID]: chaiHead,
      ['01JAK7ROHAN000000000000000']: rohanHead,
    };
    return {
      ...base,
      lookupHandle: (h) => heads[h.toLowerCase()],
      loadVersion: (id, version) => {
        if (id === '01JAK7ROHAN000000000000000') return rohanV1;
        return base.loadVersion(id, version);
      },
    };
  }

  it('does not warn at two people', () => {
    const r = resolvePrompt(
      req({ kind: 'video', capability: 'reference2video', prompt: '@maya meets @rohan' }),
      seedance,
      multiCtx(),
    );
    expect(r.warnings).toEqual([]);
  });

  it('warns at three people (F-CHR-13)', () => {
    const priya = head('01JAK7PRIYA0000000000000000'.slice(0, 26), 'priya', 'character', 1);
    const priyaV1: LoadedVersion = { ...rohanV1, id: priya.id, handle: 'priya', display_name: 'Priya' };
    const heads: Record<string, CharacterHead> = {
      maya: mayaHead,
      rohan: rohanHead,
      priya,
      [MAYA_ID]: mayaHead,
      ['01JAK7ROHAN000000000000000']: rohanHead,
      [priya.id]: priya,
    };
    const base = makeCtx();
    const ctx: ResolverCtx = {
      ...base,
      lookupHandle: (h) => heads[h.toLowerCase()],
      knownHandles: ['maya', 'rohan', 'priya'],
      loadVersion: (id, version) => {
        if (id === '01JAK7ROHAN000000000000000') return rohanV1;
        if (id === priya.id) return priyaV1;
        return base.loadVersion(id, version);
      },
    };
    const r = resolvePrompt(
      req({ kind: 'video', capability: 'reference2video', prompt: '@maya, @rohan and @priya' }),
      seedance,
      ctx,
    );
    expect(r.warnings).toContain('3 distinct people in one shot; consistency degrades past two (F-CHR-13).');
  });
});

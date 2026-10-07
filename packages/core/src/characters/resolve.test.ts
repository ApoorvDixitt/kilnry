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
    minor_suspected: false,
    voice: { provider: 'kling', voice_id: 'kv_8f2c…' },
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
  minor_suspected: false,
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
  params_schema?: Record<string, unknown>;
}): ModelManifest {
  return ModelManifestSchema.parse({
    provider: over.provider,
    model_id: over.model_id,
    display_name: over.model_id,
    capabilities: over.capabilities,
    supports: over.supports,
    media_roles: over.media_roles ?? [],
    ...(over.params_schema ? { params_schema: over.params_schema } : {}),
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
      voice: { provider: 'kling', voice_id: 'kv_8f2c…' },
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
    // The references travel as ordered `reference` medias; the OpenRouter
    // adapter turns them into input_references[] in this order (TRD-14 §4 names
    // a different list per provider, so the resolver does not name one — see
    // the adapter test "sends a video's ordered references as input_references").
    expect(r.medias).toEqual([
      { role: 'reference', asset_id: BOARD, label: 'storyboard' },
      { role: 'reference', asset_id: ANCH },
      { role: 'reference', asset_id: TQL },
      { role: 'reference', asset_id: GLAS },
    ]);
    expect(r.provider_fragment.input_references).toBeUndefined();
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
    minor_suspected: false,
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

// TRD-14 §2 audio row: a voice id goes only to the provider that made it — Kling's
// voice_ids[] take a kling voice, a TTS model takes a voice of its own provider.
// Everything else is reported for the router, never emitted (PRD-08 B4).
describe('voice pass honours the voice provider (F-VOI-04, F-CHR-08)', () => {
  const elevenTts = manifest({
    model_id: 'eleven_v3',
    provider: 'elevenlabs',
    capabilities: ['tts'],
    supports: { resolutions: [], references_max: 0, aspect_ratios: [] },
  });

  function ctxWithVoice(voice: {
    provider: string;
    voice_id: string;
    engine?: string;
    language?: string;
  }): ResolverCtx {
    const base = makeCtx();
    return {
      ...base,
      loadVersion: (id, version) => ({ ...base.loadVersion(id, version), voice }),
    };
  }

  it('a kling voice on Kling emits voice_ids and the speech marker', () => {
    const r = resolvePrompt(
      req({ kind: 'video', capability: 'image2video', prompt: '@maya says: "Hi."' }),
      klingV3Pro,
      ctxWithVoice({ provider: 'kling', voice_id: 'kv_1' }),
    );
    expect(r.provider_fragment.voice_ids).toEqual(['kv_1']);
    expect(r.prompt).toContain('<<<voice_1>>>');
    expect(r.injections.some((i) => i.strategy === 'voice_id')).toBe(true);
    expect(r.voice_mismatch).toBeUndefined();
  });

  it('a minimax voice on Kling emits no voice id and says why', () => {
    const r = resolvePrompt(
      req({ kind: 'video', capability: 'image2video', prompt: '@maya says: "Hi."' }),
      klingV3Pro,
      ctxWithVoice({ provider: 'minimax', voice_id: 'mm_1' }),
    );
    expect(r.provider_fragment).not.toHaveProperty('voice_ids');
    expect(r.prompt).not.toContain('<<<voice_1>>>');
    expect(r.injections.some((i) => i.strategy === 'voice_id')).toBe(false);
    expect(r.warnings).toContain("@maya's voice is minimax; Kling speech needs a Kling-created voice");
    expect(r.voice_mismatch).toBeUndefined();
  });

  // F-02: the gate compared the key that paid, so a MiniMax clone hosted on fal
  // ('fal') passed for fal's Kokoro ('fal') and its voice id was emitted as
  // Kokoro's `voice`, which Kokoro's enum cannot contain. PRD-07 §6 row 15 says
  // a model that cannot use the clone falls back to a preset and says so.
  it('falls back to a preset voice on Kokoro and names the clone it cannot use', () => {
    const kokoro = manifest({
      model_id: 'fal-ai/kokoro/hindi',
      provider: 'fal',
      capabilities: ['tts'],
      supports: { resolutions: [], references_max: 0, aspect_ratios: [] },
      params_schema: { voice: { enum: ['hf_alpha', 'hf_beta'] } },
    });
    const r = resolvePrompt(
      req({ kind: 'audio', capability: 'tts', prompt: '@maya says hello' }),
      kokoro,
      ctxWithVoice({ provider: 'fal', voice_id: 'mm_clone_1', engine: 'minimax' }),
    );
    expect(r.provider_fragment.voice).toBe('hf_alpha');
    expect(r.warnings.join(' ')).toContain('cannot use');
    expect(r.warnings.join(' ')).toContain("Using preset 'hf_alpha'");
    expect(r.voice_mismatch).toBeUndefined();
  });

  it('a MiniMax clone hosted on fal still speaks through a fal MiniMax model', () => {
    const falMiniMax = manifest({
      model_id: 'fal-ai/minimax/speech-02-turbo',
      provider: 'fal',
      capabilities: ['tts'],
      supports: { resolutions: [], references_max: 0, aspect_ratios: [], voice_ids: true },
    });
    const r = resolvePrompt(
      req({ kind: 'audio', capability: 'tts', prompt: '@maya says hello' }),
      falMiniMax,
      ctxWithVoice({ provider: 'fal', voice_id: 'mm_clone_1', engine: 'minimax' }),
    );
    expect(r.injections.some((i) => i.strategy === 'voice_id')).toBe(true);
    expect(r.warnings.join(' ')).not.toContain('cannot use');
  });

  it('a minimax voice on an ElevenLabs TTS model is a mismatch for the router, not a voice_id', () => {
    const r = resolvePrompt(
      req({ kind: 'audio', capability: 'tts', prompt: '@maya: "Welcome back."' }),
      elevenTts,
      ctxWithVoice({ provider: 'minimax', voice_id: 'mm_1' }),
    );
    expect(r.provider_fragment).not.toHaveProperty('voice_id');
    expect(r.injections.some((i) => i.strategy === 'voice_id')).toBe(false);
    expect(r.voice_mismatch).toEqual({ handle: 'maya', provider: 'minimax', voice_id: 'mm_1' });
    expect(r.warnings).toContain("@maya's voice is minimax; eleven_v3 is elevenlabs");
  });

  it('an ElevenLabs voice on an ElevenLabs TTS model emits voice_id', () => {
    const r = resolvePrompt(
      req({ kind: 'audio', capability: 'tts', prompt: '@maya: "Welcome back."' }),
      elevenTts,
      ctxWithVoice({ provider: 'elevenlabs', voice_id: 'kx7' }),
    );
    expect(r.provider_fragment.voice_id).toBe('kx7');
    expect(r.injections.find((i) => i.strategy === 'voice_id')?.voice).toEqual({
      provider: 'elevenlabs',
      voice_id: 'kx7',
    });
    expect(r.voice_mismatch).toBeUndefined();
  });
});

// D-72: fal's Kling v3 text-to-video schema has no elements, references or
// frame fields, and image-to-video requires start_image_url
// (https://fal.ai/models/fal-ai/kling-video/v3/{standard,pro}/{text,image}-to-video/llms.txt,
// read 2026-10-06). A pinned model is served as pinned, so the resolver is what
// tells the user what their Character could reach there.
describe('a pinned Kling v3 endpoint (D-72)', () => {
  const klingV3ProText = manifest({
    model_id: 'fal-ai/kling-video/v3/pro/text-to-video',
    provider: 'fal',
    capabilities: ['text2video'],
    supports: { elements: false, references_max: 0, start_end_frame: false, voice_ids: true },
  });
  const klingV3ProImage = manifest({
    model_id: 'fal-ai/kling-video/v3/pro/image-to-video',
    provider: 'fal',
    capabilities: ['image2video'],
    supports: { elements: true, references_max: 4, start_end_frame: true, voice_ids: true },
    media_roles: [
      { role: 'start_frame', min: 1, max: 1, kinds: ['image'] },
      { role: 'end_frame', min: 0, max: 1, kinds: ['image'] },
      { role: 'reference', min: 0, max: 4, kinds: ['image'] },
    ],
  });
  const request = () =>
    req({
      kind: 'video',
      capability: 'text2video',
      prompt: 'Slow dolly-in on @maya at a chai stall',
      medias: [],
      params: { duration_s: 5 },
    });

  it('text-to-video carries the identity as text and says so (Example 6 form)', () => {
    const r = resolvePrompt(request(), klingV3ProText, makeCtx());
    expect(r.injections[0]).toMatchObject({ handle: 'maya', strategy: 'text' });
    expect(r.injections[0]!.notes).toContain(
      "fal-ai/kling-video/v3/pro/text-to-video has no reference slot; identity is text-only. Add a first frame to use @maya's images.",
    );
    expect(r.provider_fragment.elements).toBeUndefined();
    expect(r.prompt).toContain('A woman in her early thirties');
    expect(r.prompt).not.toContain('@maya');
  });

  it('image-to-video with no first frame opens the video on the anchor and still sends elements', () => {
    const r = resolvePrompt(request(), klingV3ProImage, makeCtx());
    expect(r.injections[0]).toMatchObject({ handle: 'maya', strategy: 'start_frame' });
    expect(r.injections[0]!.notes).toContain(
      "fal-ai/kling-video/v3/pro/image-to-video needs a first frame; @maya's anchor opens the video.",
    );
    expect(r.injections[0]!.inputs[0]).toMatchObject({ role: 'start_frame', asset_id: ANCH });
    expect(r.provider_fragment.elements).toEqual([
      { frontal_image_url: url(ANCH), reference_image_urls: [url(TQL), url(PROL)] },
    ]);
    expect(r.prompt).toContain('@Element1');
  });

  it('image-to-video with a first frame given keeps it and uses elements for the Character', () => {
    const r = resolvePrompt(
      req({
        kind: 'video',
        capability: 'image2video',
        prompt: 'Slow dolly-in on @maya at a chai stall',
        medias: [{ role: 'start_frame', asset_id: COUNTER }],
        params: { duration_s: 5 },
      }),
      klingV3ProImage,
      makeCtx(),
    );
    expect(r.injections[0]).toMatchObject({ handle: 'maya', strategy: 'elements' });
    expect(r.injections[0]!.notes).toEqual([]);
  });
});

// F-91: PRD-07 §6's acceptance asks for snapshot tests of all fifteen model rows
// and §16's twelve examples; only §7's six worked examples existed. Each case
// below names the row or example, the strategy the PRD gives, and the shape of
// what is emitted; the full resolved request is snapshotted so a change in
// what any row sends is seen in review.
describe('PRD-07 §6 model rows and §16 examples (F-CHR-09, F-91)', () => {
  const video = (prompt: string, start = false): CanonicalRequest =>
    req({
      kind: 'video',
      capability: start ? 'image2video' : 'reference2video',
      prompt,
      ...(start ? { medias: [{ role: 'start_frame', asset_id: COUNTER }] } : {}),
    });
  const image = (
    prompt: string,
    capability: CanonicalRequest['capability'] = 'image_edit',
  ): CanonicalRequest => req({ kind: 'image', capability, prompt });
  const refsModel = (
    model_id: string,
    provider: ModelManifest['provider'],
    capability: ModelManifest['capabilities'][number],
    max: number,
  ) =>
    manifest({
      model_id,
      provider,
      capabilities: [capability],
      supports: { references_max: max },
      media_roles: [{ role: 'reference', min: 0, max, kinds: ['image'] }],
    });
  const voiced = (voice: { provider: string; voice_id: string; engine?: string }): ResolverCtx => {
    const base = makeCtx();
    return { ...base, loadVersion: (id, version) => ({ ...base.loadVersion(id, version), voice }) };
  };
  const PROMPT = '@maya pours chai into a glass at dawn';

  const cases: Array<{
    name: string;
    request: CanonicalRequest;
    model: ModelManifest;
    ctx?: ResolverCtx;
    strategy: string;
    fragment?: string;
  }> = [
    {
      name: '§6 row 1 · Kling 3.0 std image-to-video (fal)',
      request: video(PROMPT, true),
      model: manifest({
        model_id: 'fal-ai/kling-video/v3/standard/image-to-video',
        provider: 'fal',
        capabilities: ['image2video'],
        supports: { elements: true, references_max: 4, start_end_frame: true },
      }),
      strategy: 'elements',
      fragment: 'elements',
    },
    {
      name: '§6 row 2 · Seedance 2.5 (OpenRouter)',
      request: video(PROMPT),
      model: seedance,
      strategy: 'reference_images',
    },
    {
      name: '§6 row 3 · Veo 3.1 reference-to-video (fal)',
      request: video(PROMPT),
      model: refsModel('fal-ai/veo3.1/reference-to-video', 'fal', 'reference2video', 3),
      strategy: 'reference_images',
    },
    {
      name: '§6 row 4 · MiniMax H3 reference-to-video (fal)',
      request: video(PROMPT),
      model: refsModel('minimax/h3/reference-to-video', 'fal', 'reference2video', 5),
      strategy: 'reference_images',
    },
    {
      name: '§6 row 5 · Nano Banana 2 edit (fal)',
      request: image(PROMPT),
      model: refsModel('fal-ai/nano-banana-2/edit', 'fal', 'image_edit', 14),
      strategy: 'reference_images',
    },
    {
      name: '§6 row 6 · Nano Banana Pro (Google)',
      request: image(PROMPT),
      model: nanoBanana,
      strategy: 'reference_images',
    },
    {
      name: '§6 row 7 · GPT Image 2.5 (OpenAI)',
      request: image(PROMPT),
      model: gptImage,
      strategy: 'reference_images',
    },
    {
      name: '§6 row 8 · Seedream 4.5 edit (fal)',
      request: image(PROMPT),
      model: refsModel('fal-ai/bytedance/seedream/v4.5/edit', 'fal', 'image_edit', 10),
      strategy: 'reference_images',
    },
    {
      name: '§6 row 9 · FLUX.1 dev LoRA (fal), LoRA ready',
      request: image(PROMPT, 'text2image'),
      model: fluxLora,
      strategy: 'lora',
      fragment: 'loras',
    },
    {
      name: '§6 row 10 · Soul 2 character (Higgsfield), Soul ID ready',
      request: image(PROMPT, 'text2image'),
      model: soulCharacter,
      strategy: 'identity_id',
    },
    {
      name: '§6 row 11 · ElevenLabs v3 TTS',
      request: req({ kind: 'audio', capability: 'tts', prompt: '@maya says: "Chai is ready."' }),
      model: manifest({
        model_id: 'eleven_v3',
        provider: 'elevenlabs',
        capabilities: ['tts'],
        supports: { references_max: 0 },
      }),
      ctx: voiced({ provider: 'elevenlabs', voice_id: 'el_riya' }),
      strategy: 'voice_id',
    },
    {
      name: '§6 row 12 · Wan 3.0 reference-to-video (fal)',
      request: video(PROMPT),
      model: refsModel('alibaba/wan-3.0/reference-to-video', 'fal', 'reference2video', 4),
      strategy: 'reference_images',
    },
    {
      name: '§6 row 13 · Qwen Image Edit 2511 (fal)',
      request: image(PROMPT),
      model: refsModel('fal-ai/qwen-image-edit-2511', 'fal', 'image_edit', 3),
      strategy: 'reference_images',
    },
    {
      name: '§6 row 14 · FLUX.2 klein 4b text-to-image (fal), no reference slot',
      request: image(PROMPT, 'text2image'),
      model: manifest({
        model_id: 'fal-ai/flux-2/klein/4b',
        provider: 'fal',
        capabilities: ['text2image'],
        supports: { references_max: 0 },
      }),
      strategy: 'text',
    },
    {
      name: '§6 row 15 · Kokoro TTS (fal) with a clone it cannot use: the default preset',
      request: req({ kind: 'audio', capability: 'tts', prompt: '@maya says: "Chai is ready."' }),
      model: manifest({
        model_id: 'fal-ai/kokoro/hindi',
        provider: 'fal',
        capabilities: ['tts'],
        supports: { references_max: 0 },
        params_schema: { voice: { enum: ['hf_alpha', 'hf_beta'] } },
      }),
      ctx: voiced({ provider: 'fal', voice_id: 'mm_clone_1', engine: 'minimax' }),
      strategy: 'text',
      fragment: 'voice',
    },
    {
      name: '§16 example 1 · FLUX.1 dev LoRA',
      request: image('@maya smiling at the camera, studio portrait', 'text2image'),
      model: fluxLora,
      strategy: 'lora',
    },
    {
      name: '§16 example 2 · FLUX.2 klein 4b (fal)',
      request: image('@maya smiling at the camera, studio portrait', 'text2image'),
      model: manifest({
        model_id: 'fal-ai/flux-2/klein/4b',
        provider: 'fal',
        capabilities: ['text2image'],
        supports: { references_max: 0 },
      }),
      strategy: 'text',
    },
    {
      name: '§16 example 3 · Nano Banana 2 with a prop',
      request: image('@maya pours chai into @chai_glass on a marble counter'),
      model: refsModel('fal-ai/nano-banana-2/edit', 'fal', 'image_edit', 14),
      strategy: 'reference_images',
    },
    {
      name: '§16 example 4 · Kling 3.0 pro with an environment',
      request: video('Slow dolly-in on @maya laughing', true),
      model: klingV3Pro,
      strategy: 'elements',
    },
    {
      name: '§16 example 5 · Seedance 2.5 (OpenRouter)',
      request: video('Slow dolly-in on @maya laughing'),
      model: seedance,
      strategy: 'reference_images',
    },
    {
      name: '§16 example 6 · Nano Banana Pro, two people',
      request: image('@maya and @chai_glass clink glasses'),
      model: nanoBanana,
      strategy: 'reference_images',
    },
    {
      name: '§16 example 7 · Seedream 4.5',
      request: image('@maya and @chai_glass dance in a kitchen'),
      model: refsModel('fal-ai/bytedance/seedream/v4.5/edit', 'fal', 'image_edit', 10),
      strategy: 'reference_images',
    },
    {
      name: '§16 example 8 · GPT Image 2.5, pinned @maya@v1',
      request: image('@maya@v1 in her old red saree'),
      model: gptImage,
      strategy: 'reference_images',
    },
    {
      name: '§16 example 9 · ElevenLabs v3',
      request: req({ kind: 'audio', capability: 'tts', prompt: "@maya says: 'Chai is ready, come down!'" }),
      model: manifest({
        model_id: 'eleven_v3',
        provider: 'elevenlabs',
        capabilities: ['tts'],
        supports: { references_max: 0 },
      }),
      ctx: voiced({ provider: 'elevenlabs', voice_id: 'el_riya' }),
      strategy: 'voice_id',
    },
    {
      name: '§16 example 11 · Soul 2 standard without a Soul ID',
      request: image('@maya presenting, Soul portrait', 'text2image'),
      model: soulStandard,
      ctx: makeCtx({ identitiesFor: () => [] }),
      strategy: 'text',
    },
    {
      name: '§16 example 12 · Veo 3.1 fast reference-to-video (fal)',
      request: video('@maya flies through a neon market'),
      model: refsModel('fal-ai/veo3.1/fast/reference-to-video', 'fal', 'reference2video', 3),
      strategy: 'reference_images',
    },
  ];

  for (const entry of cases) {
    it(entry.name, () => {
      const r = resolvePrompt(entry.request, entry.model, entry.ctx ?? makeCtx());
      const maya = r.injections.find(
        (injection) => injection.handle === 'maya' && injection.strategy !== 'voice_id',
      );
      const strategies = r.injections
        .filter((injection) => injection.handle === 'maya')
        .map((i) => i.strategy);
      expect(strategies, `${entry.name}: strategies ${JSON.stringify(strategies)}`).toContain(entry.strategy);
      if (entry.strategy !== 'voice_id') expect(maya?.strategy).toBe(entry.strategy);
      // A TTS prompt keeps "@maya says:" today; see the todo below.
      if (entry.request.capability !== 'tts') expect(r.prompt).not.toMatch(/@maya\b/);
      if (entry.fragment) expect(r.provider_fragment).toHaveProperty(entry.fragment);
      expect({
        prompt: r.prompt,
        injections: r.injections.map(({ handle, strategy, inputs }) => ({
          handle,
          strategy,
          inputs: inputs.map((i) => i.asset_id),
        })),
        fragment: Object.keys(r.provider_fragment).sort(),
        warnings: r.warnings,
      }).toMatchSnapshot();
    });
  }

  // PRD-07 §16 example 9 resolves '@maya says: "Chai is ready, come down!"' to
  // the text "Chai is ready, come down!"; the resolver leaves the mention in a
  // TTS prompt and the ElevenLabs adapter speaks the prompt. Found gap recorded
  // in the progress file for STATUS (task 65).
  it.todo('§16 example 9 · the TTS text is the spoken line, without "@maya says:"');
});

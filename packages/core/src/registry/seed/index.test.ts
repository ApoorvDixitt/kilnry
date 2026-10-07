// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { ModelManifestSchema } from '../manifest.js';
import { registrySeed } from './index.js';

// The exact set of model ids the capability-taxonomy chapter seeds for each provider
// (sections 3.1 to 3.8). fal and OpenRouter expand their table rows into more endpoint
// ids than the row count, so they are checked by size; the six providers added later
// are checked id by id so a missing or invented row fails.
const IDS: Record<string, string[]> = {
  google: [
    'gemini-3-pro-image',
    'gemini-3.1-flash-image',
    'gemini-3.1-flash-lite',
    'gemini-3.1-flash-lite-image',
    'gemini-3.1-flash-tts-preview',
    'gemini-3.1-pro-preview',
    'gemini-3.5-transcribe',
    'gemini-3.8-flash',
    'lyria-3.5',
    'veo-3.1-fast-generate-preview',
    'veo-3.1-generate-preview',
    'veo-3.1-lite-generate-preview',
  ],
  openai: [
    'gpt-4o-mini-tts',
    'gpt-4o-transcribe-diarize',
    'gpt-5.6-luna',
    'gpt-5.6-terra',
    'gpt-image-2',
    'gpt-image-2.5-flare',
    'gpt-image-2.5-sunburst',
    'gpt-transcribe',
  ],
  elevenlabs: [
    'dubbing_v1',
    'dubbing_v2',
    'eleven_flash_v2_5',
    'eleven_multilingual_v2',
    'eleven_v3',
    'eleven_v3_conversational',
    'ivc',
    'music',
    'scribe_v2',
    'sound-generation',
    'voice_changer',
  ],
  minimax: [
    'MiniMax-H3',
    'MiniMax-H3-Max',
    'MiniMax-M3',
    'asr-1.0',
    'speech-2.8-hd',
    'speech-2.8-turbo',
    'voice_clone',
    'voice_design',
  ],
  higgsfield: [
    '/v1/custom-references',
    'alibaba/wan-3.0/image-to-video',
    'alibaba/wan-3.0/reference-to-video',
    'bytedance/seedance-2.5/image-to-video',
    'bytedance/seedance-2.5/reference-to-video',
    'bytedance/seedance-2.5/text-to-video',
    'higgsfield-ai/soul/character',
    'higgsfield-ai/soul/v2/standard',
    'higgsfield/genjutsu',
    'kling-video/v3.0/pro/image-to-video',
    'kling-video/v3.0/pro/text-to-video',
    'kling-video/v3.0/std/image-to-video',
    'kling-video/v3.0/std/text-to-video',
    'marketing-studio/image',
  ],
  replicate: [
    '851-labs/background-remover',
    'black-forest-labs/flux-2-pro',
    'black-forest-labs/flux-dev',
    'openai/whisper',
    'ostris/flux-dev-lora-trainer',
    'replicate/fast-flux-trainer',
  ],
};

function idsFor(provider: string): string[] {
  return registrySeed
    .filter((model) => model.provider === provider)
    .map((model) => model.model_id)
    .sort();
}

describe('canonical registry seed', () => {
  it('contains unique, complete fal and OpenRouter manifests', () => {
    const keys = registrySeed.map((model) => `${model.provider}:${model.model_id}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(registrySeed.filter((model) => model.provider === 'fal')).toHaveLength(73);
    expect(registrySeed.filter((model) => model.provider === 'openrouter')).toHaveLength(36);
    for (const model of registrySeed) {
      expect(() => ModelManifestSchema.parse(model)).not.toThrow();
      expect(model.params_schema).toMatchObject({
        type: 'object',
        properties: expect.any(Object),
        additionalProperties: false,
      });
      expect(
        Object.keys((model.params_schema.properties ?? {}) as Record<string, unknown>).length,
      ).toBeGreaterThan(0);
    }
  });

  it.each(Object.keys(IDS))('seeds exactly the specified %s rows', (provider) => {
    expect(idsFor(provider)).toEqual([...(IDS[provider] ?? [])].sort());
  });

  it('marks every Higgsfield row as training on its inputs', () => {
    const rows = registrySeed.filter((model) => model.provider === 'higgsfield');
    expect(rows).not.toHaveLength(0);
    expect(rows.every((model) => model.training_on_inputs)).toBe(true);
  });

  it('ships the Replicate rows disabled until a key is added', () => {
    const rows = registrySeed.filter((model) => model.provider === 'replicate');
    expect(rows).not.toHaveLength(0);
    expect(rows.every((model) => !model.enabled)).toBe(true);
  });

  it('keeps D-42 routes excluded', () => {
    expect(registrySeed.some((model) => /sora/i.test(model.model_id))).toBe(false);
    expect(registrySeed.some((model) => /gemini-2\.5-flash-image/i.test(model.model_id))).toBe(false);
    expect(
      registrySeed
        .filter((model) => model.provider === 'fal' && /seedance-2\.5/i.test(model.model_id))
        .every((model) => !model.enabled),
    ).toBe(true);
  });

  // F-12: OpenAI's deprecation page (read 2026-10-06,
  // https://developers.openai.com/api/docs/deprecations) retires these four
  // transcription models from the API on 2027-02-26 and names gpt-live-transcribe
  // or gpt-transcribe as the replacements. A seeded, routable row on that list is
  // a job that will 404 after the shutdown date with nothing in the product to
  // notice, because the OpenAI adapter has no model refresh.
  it('seeds no routable OpenAI model that OpenAI has scheduled for removal', () => {
    const RETIRED = ['whisper-1', 'gpt-4o-transcribe', 'gpt-4o-mini-transcribe', 'gpt-4o-transcribe-diarize'];
    for (const model of registrySeed) {
      if (model.provider !== 'openai') continue;
      if (!RETIRED.includes(model.model_id)) continue;
      expect(model.enabled, model.model_id).toBe(false);
      expect(model.deprecated_at, model.model_id).toBe('2027-02-26T00:00:00.000Z');
    }
    // Diarised transcription still has a live home.
    const diarize = registrySeed.filter(
      (model) => model.provider === 'openai' && model.tags.includes('diarize') && model.enabled,
    );
    expect(diarize.map((model) => model.model_id)).toEqual(['gpt-transcribe']);
  });

  // F-106: TRD-07:171 lists fal-ai/minimax-music/v2 as a music model at $0.03
  // a generation. It was seeded through the image helper, so the router saw a
  // $0.03 image model and Auto in Image mode could pick it — the user paid for
  // an mp3 the image pipeline cannot show.
  it('seeds no music model as an image model', () => {
    const models = registrySeed;
    const music = models.filter((model) => model.capabilities.includes('music'));
    expect(music.length).toBeGreaterThan(0);
    for (const model of music) {
      expect(model.capabilities, model.model_id).not.toContain('text2image');
      expect(model.capabilities, model.model_id).not.toContain('image_edit');
    }
    const minimax = models.find((model) => model.model_id === 'fal-ai/minimax-music/v2')!;
    expect(minimax.capabilities).toEqual(['music']);
    expect(minimax.price_rule).toMatchObject({ kind: 'flat_per_unit', unit: 'generation', amount: 0.03 });
  });

  // D-73b: OpenAI removes gpt-4o-mini-tts on 2027-01-06 and names a Realtime-API
  // replacement, which is an adapter rather than a seed row. The row keeps
  // routing until then with a note, and no deprecated_at — the router refuses
  // any row that has one whatever its date.
  it('keeps gpt-4o-mini-tts routable with its removal note', () => {
    const row = registrySeed.find((model) => model.model_id === 'gpt-4o-mini-tts')!;
    expect(row.enabled).toBe(true);
    expect(row.deprecated_at).toBeNull();
    expect(row.deprecation_note).toContain('2027-01-06');
    expect(row.deprecation_note).toContain('gpt-realtime-2.1-mini');
  });
});

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
    expect(registrySeed.filter((model) => model.provider === 'fal')).toHaveLength(71);
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
});

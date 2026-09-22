// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The rest of the seed registry for the six providers that arrived after fal and
// OpenRouter. Every id, capability list, price rule, quality tier and flag here is
// copied from the capability-taxonomy chapter's seed tables (sections 3.3 to 3.8);
// the four Google, one OpenAI, three ElevenLabs, two MiniMax and one Higgsfield rows
// that the golden estimator tests already needed stay in `other-goldens.ts`.

import type { ModelManifest, PriceRule, Supports } from '../manifest.js';
import { referenceRoles, seed, videoSupports } from './helpers.js';

type Row = Omit<Parameters<typeof seed>[0], 'provider' | 'source_url'>;

const googlePricing = 'https://ai.google.dev/gemini-api/docs/pricing';
const googleVeo = 'https://ai.google.dev/gemini-api/docs/veo';
const openaiPricing = 'https://developers.openai.com/api/docs/pricing';
const elevenlabsPricing = 'https://elevenlabs.io/pricing/api';
const minimaxPricing = 'https://platform.minimax.io/docs/guides/pricing-paygo';
const higgsfieldDocs = 'https://docs.higgsfield.ai/docs/llms.txt';
const replicatePricing = 'https://replicate.com/pricing';

const google = (input: Row, sourceUrl = googlePricing): ModelManifest =>
  seed({ ...input, provider: 'google', source_url: sourceUrl });
const openai = (input: Row): ModelManifest =>
  seed({ ...input, provider: 'openai', source_url: openaiPricing });
const elevenlabs = (input: Row): ModelManifest =>
  seed({ ...input, provider: 'elevenlabs', source_url: elevenlabsPricing });
const minimax = (input: Row): ModelManifest =>
  seed({ ...input, provider: 'minimax', source_url: minimaxPricing });
// Every Higgsfield row carries `training_on_inputs: true` (D-44: the provider may
// train on what it is sent, so the notice must be acknowledged before a key is saved).
const higgsfield = (input: Row): ModelManifest =>
  seed({ ...input, provider: 'higgsfield', source_url: higgsfieldDocs, training_on_inputs: true });
// Replicate is a P2 provider: its rows ship disabled until a key is added.
const replicate = (input: Row): ModelManifest =>
  seed({
    ...input,
    provider: 'replicate',
    source_url: replicatePricing,
    enabled: false,
    retention_days: 0,
    moderation: { http: 200, shape: 'status.failed.error', billed: 'maybe' },
  });

const textOnlySupports: Partial<Supports> = {
  resolutions: [],
  references_max: 0,
  aspect_ratios: ['auto'],
};
const voiceSupports: Partial<Supports> = {
  resolutions: [],
  references_max: 0,
  voice_ids: true,
  aspect_ratios: ['auto'],
};

const googleImageModeration = {
  http: 200,
  shape: 'promptFeedback.blockReason',
  billed: 'no',
} as const;
const googleVideoModeration = { http: 200, shape: 'raiMediaFilteredCount', billed: 'no' } as const;
const openaiModeration = { http: 400, shape: 'moderation_blocked', billed: 'no' } as const;
const elevenlabsModeration = { http: 422, shape: 'detail.status', billed: 'no' } as const;
const minimaxModeration = { http: 422, shape: '1026', billed: 'no' } as const;
const higgsfieldModeration = { http: null, shape: 'nsfw', billed: 'no' } as const;

// A Higgsfield row prices from the provider's own estimate endpoint and falls back to
// the published per-second or per-image figure when that endpoint cannot be reached.
const higgsfieldEstimate = (fallback: PriceRule): PriceRule => ({
  kind: 'provider_estimate',
  endpoint: 'higgsfield_estimate',
  fallback,
});
const perImage = (amount: number): PriceRule => ({
  kind: 'flat_per_unit',
  unit: 'image',
  amount,
  extras: [],
});
const perSecond = (resolution: string, amount: number): PriceRule => ({
  kind: 'per_second_tiered',
  tiers: { [resolution]: { no_audio: amount } },
});

export const googleSeed: ModelManifest[] = [
  google(
    {
      model_id: 'veo-3.1-lite-generate-preview',
      display_name: 'Veo 3.1 Lite',
      capabilities: ['text2video', 'image2video'],
      price_rule: {
        kind: 'per_second_tiered',
        tiers: { '720p': { no_audio: 0.05, audio: 0.05 }, '1080p': { no_audio: 0.08, audio: 0.08 } },
      },
      quality_tier: 'draft',
      supports: videoSupports({
        resolutions: ['720p', '1080p'],
        durations: [4, 6, 8],
        audio: true,
        seed: true,
      }),
      retention_days: 2,
      moderation: googleVideoModeration,
    },
    googleVeo,
  ),
  google({
    model_id: 'gemini-3.1-flash-lite-image',
    display_name: 'Gemini 3.1 Flash Lite Image',
    capabilities: ['text2image', 'image_edit'],
    price_rule: {
      kind: 'output_tokens_table',
      tokens_by_size: { '0.5K': 1120, '1K': 1120, '2K': 1120, '4K': 1120 },
      usd_per_token: 0.00003,
    },
    quality_tier: 'draft',
    supports: { resolutions: ['0.5K', '1K', '2K', '4K'], references_max: 14, aspect_ratios: ['auto'] },
    media_roles: referenceRoles(14),
    retention_days: null,
    moderation: googleImageModeration,
  }),
  google({
    model_id: 'gemini-3.1-flash-tts-preview',
    display_name: 'Gemini 3.1 Flash TTS',
    capabilities: ['tts'],
    // 25 audio tokens per second at 20e-6 per token.
    price_rule: { kind: 'flat_per_unit', unit: 'second', amount: 0.0005, extras: [] },
    supports: voiceSupports,
    retention_days: null,
    moderation: googleImageModeration,
    tags: ['multi-speaker'],
  }),
  google({
    model_id: 'gemini-3.5-transcribe',
    display_name: 'Gemini 3.5 Transcribe',
    capabilities: ['stt'],
    price_rule: { kind: 'per_minute', amount: 0.005, unit_of: 'input', per_target_language: false },
    supports: textOnlySupports,
    media_roles: [{ role: 'audio', min: 1, max: 1, kinds: ['audio'] }],
    retention_days: null,
    moderation: googleImageModeration,
  }),
  google({
    model_id: 'gemini-3.1-pro-preview',
    display_name: 'Gemini 3.1 Pro',
    capabilities: ['llm', 'vlm'],
    price_rule: { kind: 'per_million_tokens', in: 2, out: 12 },
    quality_tier: 'premium',
    supports: { resolutions: [], references_max: 8, aspect_ratios: ['auto'] },
    media_roles: referenceRoles(8, ['image', 'video', 'audio']),
    retention_days: null,
    moderation: googleImageModeration,
    eta_s: 8,
  }),
  google({
    model_id: 'gemini-3.8-flash',
    display_name: 'Gemini 3.8 Flash',
    capabilities: ['llm', 'vlm'],
    price_rule: { kind: 'per_million_tokens', in: 0.75, out: 3.75 },
    supports: { resolutions: [], references_max: 8, aspect_ratios: ['auto'] },
    media_roles: referenceRoles(8, ['image', 'video', 'audio']),
    retention_days: null,
    moderation: googleImageModeration,
    eta_s: 6,
  }),
  google({
    model_id: 'gemini-3.1-flash-lite',
    display_name: 'Gemini 3.1 Flash Lite',
    capabilities: ['llm', 'vlm'],
    price_rule: { kind: 'per_million_tokens', in: 0.25, out: 1.5 },
    quality_tier: 'draft',
    supports: { resolutions: [], references_max: 8, aspect_ratios: ['auto'] },
    media_roles: referenceRoles(8, ['image', 'video', 'audio']),
    retention_days: null,
    moderation: googleImageModeration,
    eta_s: 5,
  }),
  google({
    model_id: 'lyria-3.5',
    display_name: 'Lyria 3.5',
    capabilities: ['music'],
    price_rule: { kind: 'flat_per_unit', unit: 'run', amount: 0.08, extras: [] },
    supports: textOnlySupports,
    retention_days: null,
    moderation: googleImageModeration,
    eta_s: 60,
  }),
];

// Both GPT Image 2.5 endpoints bill at the GPT Image 2 token rates, so they estimate
// from the same table and reconcile from the response's usage block.
const gptImageRule: PriceRule = {
  kind: 'image_tokens',
  table: {
    low: { '1024x1024': 0.006, '1024x1536': 0.005, '1536x1024': 0.005 },
    medium: { '1024x1024': 0.053, '1024x1536': 0.041, '1536x1024': 0.041 },
    high: { '1024x1024': 0.211, '1024x1536': 0.165, '1536x1024': 0.165 },
  },
  rates: { image_out: 0.00003, image_in: 0.000008, text_in: 0.000005 },
  input_tokens_per_ref: 3050,
};

export const openaiSeed: ModelManifest[] = [
  openai({
    model_id: 'gpt-image-2.5-sunburst',
    display_name: 'GPT Image 2.5 Sunburst',
    capabilities: ['image_edit'],
    price_rule: gptImageRule,
    quality_tier: 'premium',
    supports: { resolutions: ['1K', '2K', '4K'], references_max: 16, aspect_ratios: ['auto'] },
    media_roles: referenceRoles(16),
    retention_days: null,
    moderation: openaiModeration,
  }),
  openai({
    model_id: 'gpt-image-2.5-flare',
    display_name: 'GPT Image 2.5 Flare',
    capabilities: ['text2image'],
    price_rule: gptImageRule,
    supports: { resolutions: ['1K', '2K', '4K'], references_max: 16, aspect_ratios: ['auto'] },
    media_roles: referenceRoles(16),
    retention_days: null,
    moderation: openaiModeration,
  }),
  openai({
    model_id: 'gpt-4o-mini-tts',
    display_name: 'GPT-4o mini TTS',
    capabilities: ['tts'],
    // Audio output at 12 USD per million tokens, about 1,250 tokens a minute.
    price_rule: { kind: 'per_minute', amount: 0.015, unit_of: 'output', per_target_language: false },
    supports: voiceSupports,
    retention_days: null,
    moderation: openaiModeration,
  }),
  openai({
    model_id: 'gpt-transcribe',
    display_name: 'GPT Transcribe',
    capabilities: ['stt'],
    price_rule: { kind: 'per_minute', amount: 0.0045, unit_of: 'input', per_target_language: false },
    supports: textOnlySupports,
    media_roles: [{ role: 'audio', min: 1, max: 1, kinds: ['audio'] }],
    retention_days: null,
    moderation: openaiModeration,
  }),
  openai({
    model_id: 'gpt-4o-transcribe-diarize',
    display_name: 'GPT-4o Transcribe Diarize',
    capabilities: ['stt'],
    price_rule: { kind: 'per_minute', amount: 0.006, unit_of: 'input', per_target_language: false },
    supports: textOnlySupports,
    media_roles: [{ role: 'audio', min: 1, max: 1, kinds: ['audio'] }],
    retention_days: null,
    moderation: openaiModeration,
    tags: ['diarize'],
  }),
  openai({
    model_id: 'gpt-5.6-terra',
    display_name: 'GPT-5.6 Terra',
    capabilities: ['llm', 'vlm'],
    price_rule: { kind: 'per_million_tokens', in: 2, out: 12 },
    supports: { resolutions: [], references_max: 8, aspect_ratios: ['auto'] },
    media_roles: referenceRoles(8),
    retention_days: null,
    moderation: openaiModeration,
    eta_s: 8,
  }),
  openai({
    model_id: 'gpt-5.6-luna',
    display_name: 'GPT-5.6 Luna',
    capabilities: ['llm', 'vlm'],
    price_rule: { kind: 'per_million_tokens', in: 0.2, out: 1.2 },
    quality_tier: 'draft',
    supports: { resolutions: [], references_max: 8, aspect_ratios: ['auto'] },
    media_roles: referenceRoles(8),
    retention_days: null,
    moderation: openaiModeration,
    eta_s: 5,
  }),
];

export const elevenlabsSeed: ModelManifest[] = [
  elevenlabs({
    model_id: 'eleven_multilingual_v2',
    display_name: 'Eleven Multilingual v2',
    capabilities: ['tts'],
    price_rule: { kind: 'per_1k_chars', amount: 0.1 },
    quality_tier: 'premium',
    supports: voiceSupports,
    retention_days: null,
    moderation: elevenlabsModeration,
  }),
  elevenlabs({
    model_id: 'eleven_v3_conversational',
    display_name: 'Eleven v3 Conversational',
    capabilities: ['tts'],
    price_rule: { kind: 'per_1k_chars', amount: 0.05 },
    supports: voiceSupports,
    retention_days: null,
    moderation: elevenlabsModeration,
  }),
  elevenlabs({
    model_id: 'ivc',
    display_name: 'ElevenLabs Instant Voice Cloning',
    capabilities: ['voice_clone'],
    // The clone itself is not billed per call; it needs a Starter plan or above.
    price_rule: {
      kind: 'flat_per_unit',
      unit: 'clone',
      amount: 0,
      extras: [{ label: 'Starter plan or above required', extra: 'plan_required', usd: 0 }],
    },
    supports: voiceSupports,
    media_roles: [{ role: 'audio', min: 1, max: 1, kinds: ['audio'] }],
    retention_days: null,
    moderation: elevenlabsModeration,
    eta_s: 30,
  }),
  elevenlabs({
    model_id: 'sound-generation',
    display_name: 'ElevenLabs Sound Generation',
    capabilities: ['sfx'],
    price_rule: { kind: 'flat_per_unit', unit: 'second', amount: 0.002, extras: [] },
    supports: {
      resolutions: [],
      references_max: 0,
      durations: { min: 1, max: 30, step: 1 },
      aspect_ratios: ['auto'],
    },
    retention_days: null,
    moderation: elevenlabsModeration,
  }),
  elevenlabs({
    model_id: 'music',
    display_name: 'ElevenLabs Music',
    capabilities: ['music'],
    price_rule: { kind: 'per_minute', amount: 0.15, unit_of: 'output', per_target_language: false },
    supports: {
      resolutions: [],
      references_max: 0,
      durations: { min: 1, max: 300, step: 1 },
      aspect_ratios: ['auto'],
    },
    retention_days: null,
    moderation: elevenlabsModeration,
    eta_s: 60,
  }),
  elevenlabs({
    model_id: 'dubbing_v1',
    display_name: 'ElevenLabs Dubbing v1',
    capabilities: ['tts'],
    price_rule: { kind: 'per_minute', amount: 0.33, unit_of: 'input', per_target_language: true },
    supports: voiceSupports,
    media_roles: [{ role: 'audio', min: 1, max: 1, kinds: ['audio', 'video'] }],
    retention_days: null,
    moderation: elevenlabsModeration,
    tags: ['dubbing'],
    eta_s: 120,
  }),
  elevenlabs({
    model_id: 'dubbing_v2',
    display_name: 'ElevenLabs Dubbing v2',
    capabilities: ['tts'],
    price_rule: { kind: 'per_minute', amount: 2.2, unit_of: 'input', per_target_language: true },
    quality_tier: 'premium',
    supports: voiceSupports,
    media_roles: [{ role: 'audio', min: 1, max: 1, kinds: ['audio', 'video'] }],
    retention_days: null,
    moderation: elevenlabsModeration,
    tags: ['dubbing'],
    eta_s: 120,
  }),
  elevenlabs({
    model_id: 'voice_changer',
    display_name: 'ElevenLabs Voice Changer',
    capabilities: ['tts'],
    price_rule: { kind: 'per_minute', amount: 0.12, unit_of: 'input', per_target_language: false },
    supports: voiceSupports,
    media_roles: [{ role: 'audio', min: 1, max: 1, kinds: ['audio'] }],
    retention_days: null,
    moderation: elevenlabsModeration,
    tags: ['voice_change'],
    eta_s: 60,
  }),
];

export const minimaxSeed: ModelManifest[] = [
  minimax({
    model_id: 'MiniMax-H3-Max',
    display_name: 'MiniMax H3 Max',
    capabilities: ['text2video', 'image2video'],
    price_rule: {
      kind: 'per_second_tiered',
      tiers: { '480p': { no_audio: 0.05 }, '768P': { no_audio: 0.08 } },
      ref_image_free: 2,
      ref_image_usd: 0.074,
      ref_video_per_s: { '480p': 0.0553, '768P': 0.143 },
    },
    quality_tier: 'draft',
    supports: videoSupports({
      resolutions: ['480p', '768P'],
      durations: { min: 5, max: 15, step: 1 },
      references: 12,
    }),
    media_roles: referenceRoles(12),
    retention_days: 0,
    moderation: minimaxModeration,
  }),
  minimax({
    model_id: 'speech-2.8-hd',
    display_name: 'MiniMax Speech HD',
    capabilities: ['tts'],
    price_rule: { kind: 'per_1k_chars', amount: 0.1 },
    supports: voiceSupports,
    retention_days: null,
    moderation: minimaxModeration,
  }),
  minimax({
    model_id: 'voice_clone',
    display_name: 'MiniMax Voice Clone',
    capabilities: ['voice_clone'],
    // Billed once, at the first synthesis that uses the cloned voice.
    price_rule: { kind: 'flat_per_unit', unit: 'clone', amount: 1.5, extras: [] },
    supports: voiceSupports,
    media_roles: [{ role: 'audio', min: 1, max: 1, kinds: ['audio'] }],
    retention_days: null,
    moderation: minimaxModeration,
    eta_s: 60,
  }),
  minimax({
    model_id: 'asr-1.0',
    display_name: 'MiniMax ASR',
    capabilities: ['stt'],
    price_rule: { kind: 'per_minute', amount: 0.00633, unit_of: 'input', per_target_language: false },
    supports: textOnlySupports,
    media_roles: [{ role: 'audio', min: 1, max: 1, kinds: ['audio'] }],
    retention_days: null,
    moderation: minimaxModeration,
  }),
  minimax({
    model_id: 'MiniMax-M3',
    display_name: 'MiniMax M3',
    capabilities: ['llm', 'vlm'],
    price_rule: { kind: 'per_million_tokens', in: 0.3, out: 1.2 },
    quality_tier: 'draft',
    supports: { resolutions: [], references_max: 8, aspect_ratios: ['auto'] },
    media_roles: referenceRoles(8),
    retention_days: null,
    moderation: minimaxModeration,
    eta_s: 8,
  }),
];

export const higgsfieldSeed: ModelManifest[] = [
  higgsfield({
    model_id: 'higgsfield-ai/soul/v2/standard',
    display_name: 'Soul 2 · Higgsfield',
    capabilities: ['text2image'],
    price_rule: higgsfieldEstimate(perImage(0.0032)),
    supports: {
      resolutions: ['1K'],
      references_max: 0,
      seed: true,
      aspect_ratios: ['auto', '1:1', '16:9', '9:16', '3:4', '4:3'],
    },
    retention_days: 7,
    moderation: higgsfieldModeration,
    tags: ['portrait', 'style_id'],
  }),
  higgsfield({
    model_id: 'higgsfield-ai/soul/character',
    display_name: 'Soul Character · Higgsfield',
    capabilities: ['text2image'],
    // The provider publishes no figure for this endpoint, so the fallback is 0.00 and
    // the estimate carries a price_unknown tag until the authoritative estimate answers.
    price_rule: higgsfieldEstimate(perImage(0)),
    quality_tier: 'premium',
    supports: {
      resolutions: ['1K'],
      references_max: 0,
      identity_ids: ['higgsfield_soul_id'],
      seed: true,
      aspect_ratios: ['auto', '1:1', '16:9', '9:16', '3:4', '4:3'],
    },
    retention_days: 7,
    moderation: higgsfieldModeration,
    tags: ['price_unknown'],
  }),
  higgsfield({
    model_id: 'marketing-studio/image',
    display_name: 'Marketing Studio · Higgsfield',
    capabilities: ['text2image', 'image_edit'],
    price_rule: higgsfieldEstimate(perImage(0.0162)),
    supports: {
      resolutions: ['1K', '2K', '4K'],
      references_max: 4,
      aspect_ratios: ['auto', '1:1', '16:9', '9:16', '3:4', '4:3'],
    },
    media_roles: [
      { role: 'product', min: 0, max: 2, kinds: ['image'] },
      { role: 'reference', min: 0, max: 2, kinds: ['image'] },
    ],
    retention_days: 7,
    moderation: higgsfieldModeration,
  }),
  higgsfield({
    model_id: 'higgsfield/genjutsu',
    display_name: 'Genjutsu · Higgsfield',
    capabilities: ['motion_transfer', 'video2video'],
    price_rule: higgsfieldEstimate(perSecond('720p', 0.318)),
    quality_tier: 'premium',
    supports: videoSupports({
      resolutions: ['720p'],
      durations: { min: 3, max: 15, step: 1 },
      references: 4,
    }),
    media_roles: [
      { role: 'driving_video', min: 1, max: 1, kinds: ['video'] },
      { role: 'reference', min: 0, max: 4, kinds: ['image'] },
    ],
    retention_days: 7,
    moderation: higgsfieldModeration,
  }),
  higgsfield({
    model_id: 'kling-video/v3.0/std/text-to-video',
    display_name: 'Kling 3.0 Standard via Higgsfield',
    capabilities: ['text2video'],
    price_rule: higgsfieldEstimate(perSecond('720p', 0.084)),
    supports: {
      ...videoSupports({
        resolutions: ['720p'],
        durations: { min: 3, max: 15, step: 1 },
        audio: true,
      }),
      multi_shot: true,
    },
    retention_days: 7,
    moderation: higgsfieldModeration,
  }),
  higgsfield({
    model_id: 'kling-video/v3.0/pro/image-to-video',
    display_name: 'Kling 3.0 Pro via Higgsfield',
    capabilities: ['image2video'],
    price_rule: higgsfieldEstimate(perSecond('720p', 0.112)),
    quality_tier: 'premium',
    supports: {
      ...videoSupports({
        resolutions: ['720p'],
        durations: { min: 3, max: 15, step: 1 },
        audio: true,
        startEnd: true,
      }),
      multi_shot: true,
    },
    retention_days: 7,
    moderation: higgsfieldModeration,
  }),
  higgsfield({
    model_id: 'kling-video/v3.0/pro/text-to-video',
    display_name: 'Kling 3.0 Pro via Higgsfield',
    capabilities: ['text2video'],
    price_rule: higgsfieldEstimate(perSecond('720p', 0.112)),
    quality_tier: 'premium',
    supports: {
      ...videoSupports({
        resolutions: ['720p'],
        durations: { min: 3, max: 15, step: 1 },
        audio: true,
      }),
      multi_shot: true,
    },
    retention_days: 7,
    moderation: higgsfieldModeration,
  }),
  higgsfield({
    model_id: 'bytedance/seedance-2.5/reference-to-video',
    display_name: 'Seedance 2.5 via Higgsfield',
    capabilities: ['reference2video'],
    price_rule: higgsfieldEstimate(perSecond('480p', 0.0738)),
    supports: videoSupports({
      resolutions: ['480p', '720p'],
      durations: { min: 3, max: 15, step: 1 },
      audio: true,
      references: 4,
    }),
    media_roles: referenceRoles(4, ['image', 'video', 'audio']),
    retention_days: 7,
    moderation: higgsfieldModeration,
  }),
  higgsfield({
    model_id: 'bytedance/seedance-2.5/image-to-video',
    display_name: 'Seedance 2.5 via Higgsfield',
    capabilities: ['image2video'],
    price_rule: higgsfieldEstimate(perSecond('480p', 0.0738)),
    supports: videoSupports({
      resolutions: ['480p', '720p'],
      durations: { min: 3, max: 15, step: 1 },
      audio: true,
      startEnd: true,
    }),
    retention_days: 7,
    moderation: higgsfieldModeration,
  }),
  higgsfield({
    model_id: 'bytedance/seedance-2.5/text-to-video',
    display_name: 'Seedance 2.5 via Higgsfield',
    capabilities: ['text2video'],
    price_rule: higgsfieldEstimate(perSecond('480p', 0.0738)),
    supports: videoSupports({
      resolutions: ['480p', '720p'],
      durations: { min: 3, max: 15, step: 1 },
      audio: true,
    }),
    retention_days: 7,
    moderation: higgsfieldModeration,
  }),
  higgsfield({
    model_id: 'alibaba/wan-3.0/image-to-video',
    display_name: 'Wan 3.0 via Higgsfield',
    capabilities: ['image2video'],
    price_rule: higgsfieldEstimate(perSecond('480p', 0.05)),
    supports: videoSupports({
      resolutions: ['480p', '720p'],
      durations: { min: 3, max: 30, step: 1 },
      startEnd: true,
    }),
    retention_days: 7,
    moderation: higgsfieldModeration,
  }),
  higgsfield({
    model_id: 'alibaba/wan-3.0/reference-to-video',
    display_name: 'Wan 3.0 via Higgsfield',
    capabilities: ['reference2video'],
    price_rule: higgsfieldEstimate(perSecond('480p', 0.05)),
    supports: videoSupports({
      resolutions: ['480p', '720p'],
      durations: { min: 3, max: 30, step: 1 },
      references: 4,
    }),
    media_roles: referenceRoles(4),
    retention_days: 7,
    moderation: higgsfieldModeration,
  }),
  higgsfield({
    model_id: '/v1/custom-references',
    display_name: 'Soul ID training · Higgsfield',
    capabilities: ['train_identity'],
    price_rule: { kind: 'flat_per_unit', unit: 'run', amount: 2.5, extras: [] },
    supports: { resolutions: [], references_max: 100, aspect_ratios: ['auto'] },
    media_roles: [{ role: 'reference', min: 1, max: 100, kinds: ['image'] }],
    retention_days: 7,
    moderation: higgsfieldModeration,
    eta_s: 900,
  }),
];

export const replicateSeed: ModelManifest[] = [
  replicate({
    model_id: 'black-forest-labs/flux-2-pro',
    display_name: 'FLUX.2 pro via Replicate',
    capabilities: ['text2image', 'image_edit'],
    price_rule: { kind: 'per_megapixel', per_mp_usd: 0.03, count_inputs: false, round: 'ceil_each' },
    supports: {
      resolutions: ['1K', '2K', '4K'],
      references_max: 8,
      seed: true,
      aspect_ratios: ['auto', '1:1', '16:9', '9:16', '3:4', '4:3'],
    },
    media_roles: referenceRoles(8),
  }),
  replicate({
    model_id: 'black-forest-labs/flux-dev',
    display_name: 'FLUX dev via Replicate',
    capabilities: ['text2image', 'image_edit'],
    price_rule: { kind: 'flat_per_unit', unit: 'image', amount: 0.025, extras: [] },
    supports: {
      resolutions: ['1K'],
      references_max: 0,
      seed: true,
      aspect_ratios: ['auto', '1:1', '16:9', '9:16', '3:4', '4:3'],
    },
  }),
  replicate({
    model_id: 'replicate/fast-flux-trainer',
    display_name: 'Fast FLUX trainer',
    capabilities: ['train_lora'],
    // Compute-billed: about 1.46 USD for a run under two minutes on eight H200s.
    price_rule: { kind: 'per_compute_second', usd_per_s: 0.0122, typical_s: 120 },
    supports: { resolutions: [], references_max: 100, aspect_ratios: ['auto'] },
    media_roles: [{ role: 'reference', min: 1, max: 100, kinds: ['image'] }],
    eta_s: 120,
  }),
  replicate({
    model_id: 'ostris/flux-dev-lora-trainer',
    display_name: 'FLUX dev LoRA trainer',
    capabilities: ['train_lora'],
    // Compute-billed: about 1.83 USD for a twenty-minute run.
    price_rule: { kind: 'per_compute_second', usd_per_s: 0.001525, typical_s: 1200 },
    supports: { resolutions: [], references_max: 100, aspect_ratios: ['auto'] },
    media_roles: [{ role: 'reference', min: 1, max: 100, kinds: ['image'] }],
    eta_s: 1200,
  }),
  replicate({
    model_id: '851-labs/background-remover',
    display_name: 'Background Remover via Replicate',
    capabilities: ['bg_remove'],
    price_rule: { kind: 'per_compute_second', usd_per_s: 0.000225, typical_s: 4 },
    quality_tier: 'draft',
    supports: { resolutions: [], references_max: 0, aspect_ratios: ['auto'] },
    media_roles: [{ role: 'reference', min: 1, max: 1, kinds: ['image'] }],
    eta_s: 8,
  }),
  replicate({
    model_id: 'openai/whisper',
    display_name: 'Whisper via Replicate',
    capabilities: ['stt'],
    price_rule: { kind: 'per_compute_second', usd_per_s: 0.0014, typical_s: 30 },
    quality_tier: 'draft',
    supports: textOnlySupports,
    media_roles: [{ role: 'audio', min: 1, max: 1, kinds: ['audio'] }],
    eta_s: 30,
  }),
];

export const remainingProvidersSeed: ModelManifest[] = [
  ...googleSeed,
  ...openaiSeed,
  ...elevenlabsSeed,
  ...minimaxSeed,
  ...higgsfieldSeed,
  ...replicateSeed,
];

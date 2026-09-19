// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import type { ModelManifest, PriceRule } from '../manifest.js';
import { referenceRoles, seed, videoSupports } from './helpers.js';

const source = (id: string): string => `https://fal.ai/models/${id}`;
const fal = (
  input: Omit<Parameters<typeof seed>[0], 'provider' | 'source_url'> & { source_url?: string },
): ModelManifest =>
  seed({ ...input, provider: 'fal', source_url: input.source_url ?? source(input.model_id) });

function mapped(
  ids: string[],
  common: Omit<Parameters<typeof fal>[0], 'model_id' | 'display_name'>,
  name: (id: string) => string,
): ModelManifest[] {
  return ids.map((model_id) => fal({ ...common, model_id, display_name: name(model_id) }));
}

const klingRule = (tier: 'standard' | 'pro'): PriceRule => ({
  kind: 'per_second_tiered',
  tiers: {
    '720p':
      tier === 'standard'
        ? { no_audio: 0.084, audio: 0.126, voice: 0.154 }
        : { no_audio: 0.112, audio: 0.168, voice: 0.196 },
    '1080p':
      tier === 'standard'
        ? { no_audio: 0.084, audio: 0.126, voice: 0.154 }
        : { no_audio: 0.112, audio: 0.168, voice: 0.196 },
  },
  elements_multiplier: 2,
});

const kling = (tier: 'standard' | 'pro'): ModelManifest[] =>
  mapped(
    [`fal-ai/kling-video/v3/${tier}/text-to-video`, `fal-ai/kling-video/v3/${tier}/image-to-video`],
    {
      capabilities: ['text2video', 'image2video', 'reference2video'],
      price_rule: klingRule(tier),
      quality_tier: tier === 'pro' ? 'premium' : 'standard',
      supports: videoSupports({
        resolutions: tier === 'pro' ? ['1080p'] : ['720p'],
        audio: true,
        references: 4,
        elements: true,
        voiceIds: true,
        startEnd: true,
        negative: true,
      }),
      media_roles: referenceRoles(4),
      retention_days: 7,
      eta_s: 90,
      tags: ['elements', 'native-audio'],
      concurrency_override: 1,
    },
    (id) =>
      id.includes('image-to-video') ? `Kling 3.0 ${tier} image-to-video` : `Kling 3.0 ${tier} text-to-video`,
  );

const veoRule = (rates: Record<string, { no_audio: number; audio: number }>): PriceRule => ({
  kind: 'per_second_tiered',
  tiers: rates,
});

const imageFlat = (
  ids: string[],
  display: string,
  amount: number,
  options: {
    refs?: number;
    tier?: 'draft' | 'standard' | 'premium';
    tags?: string[];
    supports?: Record<string, unknown>;
  } = {},
): ModelManifest[] =>
  mapped(
    ids,
    {
      capabilities: ids.some((id) => /edit|kontext|qwen/.test(id))
        ? ['text2image', 'image_edit']
        : ['text2image'],
      price_rule: { kind: 'flat_per_unit', unit: 'image', amount, extras: [] },
      quality_tier: options.tier ?? 'standard',
      supports: {
        resolutions: ['1K', '2K', '4K'],
        references_max: options.refs ?? 0,
        seed: true,
        aspect_ratios: ['auto', '1:1', '16:9', '9:16', '3:4', '4:3'],
        ...(options.supports ?? {}),
      },
      media_roles: referenceRoles(options.refs ?? 0),
      tags: options.tags ?? [],
    },
    (id) => `${display}${id.includes('edit') ? ' edit' : ''}`,
  );

export const falSeed: ModelManifest[] = [
  ...kling('standard'),
  ...kling('pro'),
  ...mapped(
    ['fal-ai/kling-video/v3/standard/motion-control', 'fal-ai/kling-video/v3/pro/motion-control'],
    {
      capabilities: ['motion_transfer'],
      price_rule: {
        kind: 'per_second_tiered',
        tiers: { '720p': { no_audio: 0.126 }, '1080p': { no_audio: 0.168 } },
      },
      supports: videoSupports({ resolutions: ['720p', '1080p'], references: 1, elements: true }),
      media_roles: [
        { role: 'reference', min: 1, max: 1, kinds: ['image'] },
        { role: 'driving_video', min: 1, max: 1, kinds: ['video'] },
      ],
      eta_s: 120,
    },
    (id) => (id.includes('/pro/') ? 'Kling 3.0 pro motion control' : 'Kling 3.0 standard motion control'),
  ),
  fal({
    model_id: 'fal-ai/kling-video/o3/standard/image-to-video',
    display_name: 'Kling O3 standard',
    capabilities: ['image2video'],
    price_rule: { kind: 'per_second_tiered', tiers: { '720p': { no_audio: 0.084, audio: 0.112 } } },
    supports: videoSupports({ durations: [5, 10], resolutions: ['720p'], audio: true, startEnd: true }),
    media_roles: [
      { role: 'start_frame', min: 1, max: 1, kinds: ['image'] },
      { role: 'end_frame', min: 0, max: 1, kinds: ['image'] },
    ],
  }),
  ...mapped(
    [
      'bytedance/seedance-2.0/text-to-video',
      'bytedance/seedance-2.0/image-to-video',
      'bytedance/seedance-2.0/reference-to-video',
    ],
    {
      capabilities: ['text2video', 'image2video', 'reference2video'],
      price_rule: {
        kind: 'video_tokens',
        usd_per_token: { default: 0.000014, '4k': 0.000008 },
        fps: 24,
        divisor: 1024,
        fixed_usd: 0.005,
      },
      quality_tier: 'premium',
      supports: videoSupports({
        resolutions: ['480p', '720p', '1080p', '4k'],
        durations: { min: 4, max: 15, step: 1 },
        audio: true,
        references: 12,
        startEnd: true,
        seed: true,
        aspects: ['auto', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
      }),
      media_roles: referenceRoles(12, ['image', 'video', 'audio']),
      eta_s: 120,
      tags: ['native-audio'],
    },
    () => 'Seedance 2.0',
  ),
  ...mapped(
    ['bytedance/seedance-2.5/text-to-video', 'bytedance/seedance-2.5/image-to-video'],
    {
      capabilities: ['text2video', 'image2video'],
      price_rule: {
        kind: 'video_tokens',
        usd_per_token: { default: 0.0000214 },
        fps: 24,
        divisor: 1024,
        fixed_usd: 0,
      },
      supports: videoSupports({
        resolutions: ['480p', '720p', '1080p'],
        durations: { min: 4, max: 30, step: 1 },
        audio: true,
        startEnd: true,
        seed: true,
      }),
      tags: ['expensive-route'],
      enabled: false,
      eta_s: 120,
    },
    () => 'Seedance 2.5 (fal route excluded)',
  ),
  ...mapped(
    ['minimax/h3/text-to-video', 'minimax/h3/image-to-video', 'minimax/h3/reference-to-video'],
    {
      capabilities: ['text2video', 'image2video', 'reference2video'],
      price_rule: {
        kind: 'per_second_tiered',
        tiers: {
          '480p': { no_audio: 0.05, audio: 0.05 },
          '768P': { no_audio: 0.06, audio: 0.06 },
          '2K': { no_audio: 0.13, audio: 0.13 },
          '4K': { no_audio: 0.16, audio: 0.16 },
        },
        ref_image_free: 5,
        ref_image_usd: 0.04,
      },
      supports: videoSupports({
        resolutions: ['480p', '768P', '2K', '4K'],
        durations: { min: 4, max: 15, step: 1 },
        audio: true,
        references: 12,
        startEnd: true,
      }),
      media_roles: referenceRoles(12, ['image', 'video', 'audio']),
      eta_s: 100,
    },
    () => 'MiniMax H3',
  ),
  ...mapped(
    ['minimax/h3-max/text-to-video', 'minimax/h3-max/image-to-video'],
    {
      capabilities: ['text2video', 'image2video'],
      price_rule: {
        kind: 'per_second_tiered',
        tiers: { '480p': { no_audio: 0.025 }, '768P': { no_audio: 0.04 }, '1080p': { no_audio: 0.08 } },
        ref_image_free: 2,
        ref_image_usd: 0.074,
      },
      quality_tier: 'draft',
      supports: videoSupports({
        resolutions: ['480p', '768P', '1080p'],
        durations: { min: 5, max: 15, step: 1 },
        references: 6,
        startEnd: true,
      }),
      media_roles: referenceRoles(6),
      eta_s: 75,
    },
    () => 'MiniMax H3 Max',
  ),
  ...mapped(
    ['fal-ai/veo3.1/fast', 'fal-ai/veo3.1/fast/image-to-video'],
    {
      capabilities: ['text2video', 'image2video'],
      price_rule: veoRule({
        '720p': { no_audio: 0.1, audio: 0.15 },
        '1080p': { no_audio: 0.1, audio: 0.15 },
        '4k': { no_audio: 0.3, audio: 0.35 },
      }),
      supports: videoSupports({
        resolutions: ['720p', '1080p', '4k'],
        durations: [4, 6, 8],
        audio: true,
        startEnd: true,
        seed: true,
        negative: true,
        aspects: ['16:9', '9:16'],
      }),
      eta_s: 120,
    },
    () => 'Veo 3.1 Fast',
  ),
  ...mapped(
    ['fal-ai/veo3.1/lite', 'fal-ai/veo3.1/lite/image-to-video'],
    {
      capabilities: ['text2video', 'image2video'],
      price_rule: veoRule({
        '720p': { no_audio: 0.03, audio: 0.05 },
        '1080p': { no_audio: 0.05, audio: 0.08 },
      }),
      quality_tier: 'draft',
      supports: videoSupports({
        resolutions: ['720p', '1080p'],
        durations: [4, 6, 8],
        audio: true,
        startEnd: true,
        aspects: ['16:9', '9:16'],
      }),
    },
    () => 'Veo 3.1 Lite',
  ),
  ...mapped(
    ['fal-ai/veo3.1', 'fal-ai/veo3.1/image-to-video', 'fal-ai/veo3.1/reference-to-video'],
    {
      capabilities: ['text2video', 'image2video', 'reference2video'],
      price_rule: veoRule({
        '720p': { no_audio: 0.2, audio: 0.4 },
        '1080p': { no_audio: 0.2, audio: 0.4 },
        '4k': { no_audio: 0.4, audio: 0.6 },
      }),
      quality_tier: 'premium',
      supports: videoSupports({
        resolutions: ['720p', '1080p', '4k'],
        durations: [4, 6, 8],
        audio: true,
        references: 3,
        startEnd: true,
        seed: true,
        negative: true,
        aspects: ['16:9', '9:16'],
      }),
      media_roles: referenceRoles(3),
      eta_s: 180,
    },
    () => 'Veo 3.1',
  ),
  ...mapped(
    ['alibaba/wan-3.0/text-to-video', 'alibaba/wan-3.0/image-to-video', 'alibaba/wan-3.0/reference-to-video'],
    {
      capabilities: ['text2video', 'image2video', 'reference2video'],
      price_rule: {
        kind: 'per_second_tiered',
        tiers: {
          '480p': { no_audio: 0.05, audio: 0.05 },
          '720p': { no_audio: 0.1, audio: 0.1 },
          '1080p': { no_audio: 0.2, audio: 0.2 },
        },
      },
      supports: videoSupports({
        resolutions: ['480p', '720p', '1080p'],
        durations: { min: 2, max: 30, step: 1 },
        audio: true,
        references: 12,
        startEnd: true,
        seed: true,
      }),
      media_roles: referenceRoles(12, ['image', 'video', 'audio']),
    },
    () => 'Wan 3.0',
  ),
  ...mapped(
    ['fal-ai/wan/v2.7/image-to-video', 'fal-ai/wan/v2.7/video-edit'],
    {
      capabilities: ['image2video', 'video2video'],
      price_rule: {
        kind: 'per_second_tiered',
        tiers: { '720p': { no_audio: 0.1, audio: 0.1 }, '1080p': { no_audio: 0.15, audio: 0.15 } },
      },
      supports: videoSupports({
        resolutions: ['720p', '1080p'],
        durations: { min: 2, max: 15, step: 1 },
        audio: true,
        references: 4,
        startEnd: true,
        seed: true,
        negative: true,
      }),
      media_roles: referenceRoles(4, ['image', 'video']),
    },
    () => 'Wan 2.7',
  ),
  ...mapped(
    ['fal-ai/kling-video/lipsync/audio-to-video', 'fal-ai/kling-video/lipsync/text-to-video'],
    {
      capabilities: ['lipsync'],
      price_rule: { kind: 'per_second_tiered', tiers: { '1080p': { no_audio: 0.014 } }, round_up_to_s: 5 },
      supports: videoSupports({ resolutions: ['1080p'], durations: { min: 2, max: 60, step: 1 } }),
      media_roles: [
        { role: 'video', min: 1, max: 1, kinds: ['video'] },
        { role: 'audio', min: 0, max: 1, kinds: ['audio'] },
      ],
      eta_s: 720,
    },
    () => 'Kling lip-sync',
  ),
  fal({
    model_id: 'fal-ai/kling-video/ai-avatar/v2/pro',
    display_name: 'Kling AI Avatar',
    capabilities: ['avatar'],
    price_rule: { kind: 'flat_per_unit', unit: 'second', amount: 0.115, extras: [] },
    supports: videoSupports({ resolutions: ['1080p'] }),
    media_roles: referenceRoles(1),
    eta_s: 120,
  }),
  fal({
    model_id: 'fal-ai/topaz/upscale/video',
    display_name: 'Topaz Video Upscale',
    capabilities: ['upscale_video'],
    price_rule: {
      kind: 'per_second_tiered',
      tiers: { '720p': { no_audio: 0.01 }, '1080p': { no_audio: 0.02 }, '4k': { no_audio: 0.08 } },
      fps60_multiplier: 2,
    },
    supports: videoSupports({
      resolutions: ['720p', '1080p', '4k'],
      durations: { min: 1, max: 3600, step: 1 },
    }),
    media_roles: [{ role: 'video', min: 1, max: 1, kinds: ['video'] }],
    eta_s: 180,
  }),
  fal({
    model_id: 'fal-ai/image-editing/reframe',
    display_name: 'Image Reframe',
    capabilities: ['reframe_image', 'outpaint'],
    price_rule: { kind: 'flat_per_unit', unit: 'image', amount: 0.04, extras: [] },
    supports: { resolutions: ['1K', '2K', '4K'], references_max: 1, aspect_ratios: ['auto'] },
    media_roles: referenceRoles(1),
  }),
  fal({
    model_id: 'fal-ai/flux-2-pro',
    display_name: 'FLUX.2 Pro',
    capabilities: ['text2image'],
    price_rule: {
      kind: 'per_megapixel',
      first_mp_usd: 0.03,
      per_mp_usd: 0.015,
      count_inputs: true,
      round: 'ceil_each',
    },
    supports: {
      resolutions: ['1K', '2K', '4K'],
      references_max: 9,
      seed: true,
      aspect_ratios: ['auto', '1:1', '16:9', '9:16'],
    },
    media_roles: referenceRoles(9),
  }),
  fal({
    model_id: 'fal-ai/flux-2-pro/edit',
    display_name: 'FLUX.2 Pro Edit',
    capabilities: ['image_edit'],
    price_rule: {
      kind: 'per_megapixel',
      first_mp_usd: 0.03,
      per_mp_usd: 0.015,
      count_inputs: true,
      round: 'ceil_each',
    },
    supports: {
      resolutions: ['1K', '2K', '4K'],
      references_max: 9,
      seed: true,
      aspect_ratios: ['auto', '1:1', '16:9', '9:16'],
    },
    media_roles: referenceRoles(9),
  }),
  fal({
    model_id: 'fal-ai/flux-2/klein/4b',
    display_name: 'FLUX.2 Klein 4B',
    capabilities: ['text2image'],
    price_rule: { kind: 'per_megapixel', per_mp_usd: 0.005, count_inputs: false, round: 'ceil_each' },
    quality_tier: 'draft',
    supports: {
      resolutions: ['1K', '2K'],
      references_max: 4,
      seed: true,
      aspect_ratios: ['auto', '1:1', '16:9', '9:16'],
    },
    media_roles: referenceRoles(4),
    eta_s: 8,
  }),
  fal({
    model_id: 'fal-ai/flux-lora',
    display_name: 'FLUX LoRA',
    capabilities: ['text2image'],
    price_rule: { kind: 'per_megapixel', per_mp_usd: 0.035, count_inputs: false, round: 'ceil_each' },
    supports: {
      resolutions: ['1K', '2K'],
      references_max: 0,
      lora: true,
      seed: true,
      aspect_ratios: ['auto'],
    },
  }),
  fal({
    model_id: 'fal-ai/flux-2/lora',
    display_name: 'FLUX.2 LoRA',
    capabilities: ['text2image'],
    price_rule: { kind: 'per_megapixel', per_mp_usd: 0.021, count_inputs: false, round: 'ceil_each' },
    supports: {
      resolutions: ['1K', '2K'],
      references_max: 0,
      lora: true,
      seed: true,
      aspect_ratios: ['auto'],
    },
  }),
  ...imageFlat(['fal-ai/flux-pro/kontext', 'fal-ai/flux-pro/kontext/max/multi'], 'FLUX Kontext', 0.04, {
    refs: 6,
  }),
  ...mapped(
    ['fal-ai/nano-banana-2', 'fal-ai/nano-banana-2/edit'],
    {
      capabilities: ['text2image', 'image_edit'],
      price_rule: {
        kind: 'flat_per_unit',
        unit: 'image',
        amount: 0.08,
        by: { key: 'resolution', table: { '0.5K': 0.06, '1K': 0.08, '2K': 0.12, '4K': 0.16 } },
        extras: [{ label: 'web search', extra: 'web_search', usd: 0.015 }],
      },
      supports: {
        resolutions: ['0.5K', '1K', '2K', '4K'],
        references_max: 14,
        aspect_ratios: ['auto', '1:1', '16:9', '9:16', '3:4', '4:3', '21:9'],
      },
      media_roles: referenceRoles(14),
    },
    () => 'Nano Banana 2',
  ),
  ...mapped(
    ['fal-ai/nano-banana-pro', 'fal-ai/nano-banana-pro/edit'],
    {
      capabilities: ['text2image', 'image_edit'],
      price_rule: {
        kind: 'flat_per_unit',
        unit: 'image',
        amount: 0.15,
        by: { key: 'resolution', table: { '1K': 0.15, '2K': 0.15, '4K': 0.3 } },
        extras: [{ label: 'web search', extra: 'web_search', usd: 0.015 }],
      },
      quality_tier: 'premium',
      supports: {
        resolutions: ['1K', '2K', '4K'],
        references_max: 14,
        aspect_ratios: ['auto', '1:1', '16:9', '9:16', '3:4'],
      },
      media_roles: referenceRoles(14),
    },
    () => 'Nano Banana Pro',
  ),
  ...imageFlat(['openai/gpt-image-2', 'openai/gpt-image-2/edit'], 'GPT Image 2 via fal', 0.053, {
    refs: 16,
    tier: 'premium',
  }),
  ...imageFlat(
    ['fal-ai/bytedance/seedream/v4.5/text-to-image', 'fal-ai/bytedance/seedream/v4.5/edit'],
    'Seedream 4.5',
    0.04,
    { refs: 10 },
  ),
  ...imageFlat(
    ['fal-ai/bytedance/seedream/v5/lite/text-to-image', 'fal-ai/bytedance/seedream/v5/lite/edit'],
    'Seedream 5 Lite',
    0.035,
    { refs: 14 },
  ),
  ...imageFlat(
    ['bytedance/seedream/v5/pro/text-to-image', 'bytedance/seedream/v5/pro/edit'],
    'Seedream 5 Pro',
    0.0675,
    { refs: 14, tier: 'premium' },
  ),
  fal({
    model_id: 'fal-ai/qwen-image-edit-2511',
    display_name: 'Qwen Image Edit 2511',
    capabilities: ['image_edit'],
    price_rule: { kind: 'per_megapixel', per_mp_usd: 0.03, count_inputs: false, round: 'exact' },
    supports: { resolutions: ['1K', '2K'], references_max: 4, seed: true, aspect_ratios: ['auto'] },
    media_roles: referenceRoles(4),
  }),
  ...imageFlat(['fal-ai/ideogram/v3'], 'Ideogram v3', 0.03, { refs: 1, tags: ['typography'] }),
  ...imageFlat(['fal-ai/recraft/v3/text-to-image'], 'Recraft v3', 0.04, { tags: ['typography', 'vector'] }),
  fal({
    model_id: 'fal-ai/clarity-upscaler',
    display_name: 'Clarity Upscaler',
    capabilities: ['upscale_image'],
    price_rule: { kind: 'per_megapixel', per_mp_usd: 0.03, count_inputs: false, round: 'exact' },
    supports: { resolutions: ['2K', '4K'], references_max: 1, aspect_ratios: ['auto'] },
    media_roles: referenceRoles(1),
  }),
  fal({
    model_id: 'fal-ai/aura-sr',
    display_name: 'AuraSR',
    capabilities: ['upscale_image'],
    price_rule: { kind: 'per_compute_second', usd_per_s: 0.0008, typical_s: 8 },
    quality_tier: 'draft',
    supports: { resolutions: ['4K'], references_max: 1, aspect_ratios: ['auto'] },
    media_roles: referenceRoles(1),
  }),
  fal({
    model_id: 'fal-ai/bria/background/remove',
    display_name: 'Bria Background Remove',
    capabilities: ['bg_remove'],
    price_rule: { kind: 'flat_per_unit', unit: 'image', amount: 0.018, extras: [] },
    supports: { resolutions: ['1K', '2K', '4K'], references_max: 1, aspect_ratios: ['auto'] },
    media_roles: referenceRoles(1),
  }),
  fal({
    model_id: 'fal-ai/trellis',
    display_name: 'Trellis 3D',
    capabilities: ['3d'],
    price_rule: { kind: 'flat_per_unit', unit: 'generation', amount: 0.02, extras: [] },
    quality_tier: 'draft',
    supports: { resolutions: [], references_max: 1, aspect_ratios: ['auto'] },
    media_roles: referenceRoles(1),
  }),
  fal({
    model_id: 'fal-ai/hunyuan3d-v3/image-to-3d',
    display_name: 'Hunyuan3D v3',
    capabilities: ['3d'],
    price_rule: { kind: 'flat_per_unit', unit: 'generation', amount: 0.375, extras: [] },
    supports: { resolutions: [], references_max: 1, aspect_ratios: ['auto'] },
    media_roles: referenceRoles(1),
  }),
  fal({
    model_id: 'fal-ai/kokoro/american-english',
    display_name: 'Kokoro American English',
    capabilities: ['tts'],
    price_rule: { kind: 'per_1k_chars', amount: 0.02 },
    quality_tier: 'draft',
    supports: { resolutions: [], references_max: 0, voice_ids: true, aspect_ratios: ['auto'] },
    retention_days: null,
    eta_s: 4,
  }),
  fal({
    model_id: 'fal-ai/minimax/speech-2.8-hd',
    display_name: 'MiniMax Speech 2.8 HD',
    capabilities: ['tts'],
    price_rule: { kind: 'per_1k_chars', amount: 0.1 },
    supports: { resolutions: [], references_max: 0, voice_ids: true, aspect_ratios: ['auto'] },
    retention_days: null,
    eta_s: 5,
  }),
  fal({
    model_id: 'fal-ai/minimax/speech-02-turbo',
    display_name: 'MiniMax Speech Turbo',
    capabilities: ['tts'],
    price_rule: { kind: 'per_1k_chars', amount: 0.06 },
    quality_tier: 'draft',
    supports: { resolutions: [], references_max: 0, voice_ids: true, aspect_ratios: ['auto'] },
    retention_days: null,
    eta_s: 4,
  }),
  fal({
    model_id: 'fal-ai/minimax/voice-clone',
    display_name: 'MiniMax Voice Clone',
    capabilities: ['voice_clone'],
    price_rule: { kind: 'flat_per_unit', unit: 'clone', amount: 1.5, extras: [] },
    supports: { resolutions: [], references_max: 0, voice_ids: true, aspect_ratios: ['auto'] },
    media_roles: [{ role: 'audio', min: 1, max: 1, kinds: ['audio'] }],
    eta_s: 60,
  }),
  fal({
    model_id: 'fal-ai/elevenlabs/speech-to-text/scribe-v2',
    display_name: 'ElevenLabs Scribe v2 via fal',
    capabilities: ['stt'],
    price_rule: { kind: 'per_minute', amount: 0.008, unit_of: 'input', per_target_language: false },
    supports: { resolutions: [], references_max: 0, aspect_ratios: ['auto'] },
    media_roles: [{ role: 'audio', min: 1, max: 1, kinds: ['audio'] }],
    retention_days: null,
  }),
  fal({
    model_id: 'fal-ai/elevenlabs/sound-effects/v2',
    display_name: 'ElevenLabs Sound Effects v2',
    capabilities: ['sfx'],
    price_rule: { kind: 'flat_per_unit', unit: 'second', amount: 0.002, extras: [] },
    supports: {
      resolutions: [],
      references_max: 0,
      durations: { min: 1, max: 30, step: 1 },
      aspect_ratios: ['auto'],
    },
    retention_days: null,
  }),
  fal({
    model_id: 'fal-ai/ace-step',
    display_name: 'ACE-Step',
    capabilities: ['music'],
    price_rule: { kind: 'flat_per_unit', unit: 'second', amount: 0.0002, extras: [] },
    quality_tier: 'draft',
    supports: {
      resolutions: [],
      references_max: 0,
      durations: { min: 1, max: 300, step: 1 },
      aspect_ratios: ['auto'],
    },
    retention_days: null,
  }),
  ...imageFlat(['fal-ai/minimax-music/v2'], 'MiniMax Music v2', 0.03),
  fal({
    model_id: 'fal-ai/flux-lora-fast-training',
    display_name: 'FLUX LoRA Fast Training',
    capabilities: ['train_lora'],
    price_rule: { kind: 'per_step', usd_per_step: 0.002, min_steps: 1000 },
    supports: { resolutions: [], references_max: 20, aspect_ratios: ['auto'] },
    media_roles: referenceRoles(20),
    eta_s: 1200,
  }),
  fal({
    model_id: 'fal-ai/flux-2-trainer/edit',
    display_name: 'FLUX.2 Edit Trainer',
    capabilities: ['train_lora'],
    price_rule: {
      kind: 'per_step',
      usd_per_step: 0.0056,
      ref_multiplier: { '1': 2.11, '2': 3.44, '3': 5.09, '4': 6.95 },
    },
    supports: { resolutions: [], references_max: 4, aspect_ratios: ['auto'] },
    media_roles: referenceRoles(4),
    eta_s: 1200,
  }),
];

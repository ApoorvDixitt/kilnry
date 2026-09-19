// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import type { ModelManifest, PriceRule } from '../manifest.js';
import { referenceRoles, seed, videoSupports } from './helpers.js';

const source = 'https://openrouter.ai/api/v1';
const openrouter = (input: Omit<Parameters<typeof seed>[0], 'provider' | 'source_url'>): ModelManifest =>
  seed({ ...input, provider: 'openrouter', source_url: source });

function mapped(
  ids: string[],
  common: Omit<Parameters<typeof openrouter>[0], 'model_id' | 'display_name'>,
  displayName: string,
): ModelManifest[] {
  return ids.map((model_id) => openrouter({ ...common, model_id, display_name: displayName }));
}

const image = (
  ids: string[],
  displayName: string,
  rule: PriceRule,
  refs: number,
  tier: 'draft' | 'standard' | 'premium' = 'standard',
  tags: string[] = [],
): ModelManifest[] =>
  mapped(
    ids,
    {
      capabilities: ['text2image', 'image_edit'],
      price_rule: rule,
      quality_tier: tier,
      supports: {
        resolutions: ['0.5K', '1K', '2K', '4K'],
        references_max: refs,
        seed: true,
        aspect_ratios: ['auto', '1:1', '16:9', '9:16', '3:4', '4:3', '21:9'],
      },
      media_roles: referenceRoles(refs),
      retention_days: null,
      moderation: { http: 403, shape: 'error.metadata.reasons', billed: 'no' },
      tags,
      eta_s: 30,
    },
    displayName,
  );

const video = (
  ids: string[],
  displayName: string,
  rule: PriceRule,
  options: {
    capabilities?: Array<
      'text2video' | 'image2video' | 'reference2video' | 'video2video' | 'upscale_video' | 'avatar'
    >;
    refs?: number;
    resolutions?: Array<'480p' | '720p' | '768p' | '1080p' | '2k' | '4k'>;
    durations?: number[] | { min: number; max: number; step?: number };
    audio?: boolean;
    seed?: boolean;
    tier?: 'draft' | 'standard' | 'premium';
    tags?: string[];
  } = {},
): ModelManifest[] =>
  mapped(
    ids,
    {
      capabilities: options.capabilities ?? ['text2video', 'image2video'],
      price_rule: rule,
      quality_tier: options.tier ?? 'standard',
      supports: videoSupports({
        resolutions: options.resolutions ?? ['720p'],
        ...(options.durations === undefined ? {} : { durations: options.durations }),
        ...(options.audio === undefined ? {} : { audio: options.audio }),
        ...(options.refs === undefined ? {} : { references: options.refs }),
        startEnd: true,
        ...(options.seed === undefined ? {} : { seed: options.seed }),
        aspects: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
      }),
      media_roles: referenceRoles(options.refs ?? 0, ['image', 'video', 'audio']),
      retention_days: 0,
      moderation: { http: 403, shape: 'failed safety or RAI text', billed: 'no' },
      tags: options.tags ?? [],
      eta_s: 120,
    },
    displayName,
  );

const imageTokenRule: PriceRule = {
  kind: 'image_tokens',
  table: {
    low: { '1024x1024': 0.006, '1024x1536': 0.005, '1536x1024': 0.005 },
    medium: { '1024x1024': 0.053, '1024x1536': 0.041, '1536x1024': 0.041 },
    high: { '1024x1024': 0.211, '1024x1536': 0.165, '1536x1024': 0.165 },
  },
  rates: { image_out: 0.00003, image_in: 0.000008, text_in: 0.000005 },
  input_tokens_per_ref: 3050,
};

export const openrouterSeed: ModelManifest[] = [
  ...image(
    ['google/gemini-3.1-flash-image', 'google/gemini-3.1-flash-image-preview'],
    'Nano Banana 2',
    {
      kind: 'output_tokens_table',
      tokens_by_size: { '0.5K': 747, '1K': 1120, '2K': 1680, '4K': 2520 },
      usd_per_token: 0.00006,
      input_usd_per_token: 0.0000005,
      input_tokens_per_image: 560,
    },
    14,
  ),
  ...image(
    ['google/gemini-3.1-flash-lite-image'],
    'Nano Banana 2 Lite',
    {
      kind: 'output_tokens_table',
      tokens_by_size: { '1K': 1120 },
      usd_per_token: 0.00003,
      input_usd_per_token: 0.0000005,
      input_tokens_per_image: 560,
    },
    14,
    'draft',
  ),
  ...image(
    ['google/gemini-3-pro-image'],
    'Nano Banana Pro',
    {
      kind: 'output_tokens_table',
      tokens_by_size: { '1K': 1120, '2K': 1120, '4K': 2000 },
      usd_per_token: 0.00012,
      input_usd_per_token: 0.000002,
      input_tokens_per_image: 560,
    },
    14,
    'premium',
  ),
  ...image(
    ['bytedance-seed/seedream-4.5'],
    'Seedream 4.5',
    { kind: 'flat_per_unit', unit: 'image', amount: 0.04, extras: [] },
    14,
  ),
  ...image(
    ['bytedance-seed/seedream-5-0-lite'],
    'Seedream 5 Lite',
    { kind: 'flat_per_unit', unit: 'image', amount: 0.035, extras: [] },
    14,
  ),
  ...image(
    ['bytedance-seed/seedream-5-0-pro'],
    'Seedream 5 Pro',
    { kind: 'flat_per_unit', unit: 'image', amount: 0.045, extras: [] },
    14,
    'premium',
  ),
  ...image(
    ['black-forest-labs/flux.2-pro'],
    'FLUX.2 Pro',
    { kind: 'per_megapixel', per_mp_usd: 0.03, count_inputs: false, round: 'exact' },
    8,
  ),
  ...image(
    ['black-forest-labs/flux.2-klein-4b'],
    'FLUX.2 Klein 4B',
    { kind: 'per_megapixel', per_mp_usd: 0.014, count_inputs: false, round: 'exact' },
    4,
    'draft',
  ),
  ...image(
    ['openai/gpt-image-2', 'openai/gpt-image-2.5-sunburst', 'openai/gpt-image-2.5-flare'],
    'GPT Image',
    imageTokenRule,
    16,
    'premium',
  ),
  ...image(
    ['recraft/recraft-v4'],
    'Recraft v4',
    { kind: 'flat_per_unit', unit: 'image', amount: 0.04, extras: [] },
    0,
    'standard',
    ['typography'],
  ),
  ...image(
    ['recraft/recraft-v4-vector'],
    'Recraft v4 Vector',
    { kind: 'flat_per_unit', unit: 'image', amount: 0.08, extras: [] },
    0,
    'standard',
    ['typography', 'vector'],
  ),
  ...image(
    ['qwen/qwen-image-3'],
    'Qwen Image 3',
    { kind: 'flat_per_unit', unit: 'image', amount: 0.03, extras: [] },
    4,
    'draft',
  ),
  ...video(
    ['google/veo-3.1'],
    'Veo 3.1',
    {
      kind: 'per_second_tiered',
      tiers: {
        '720p': { no_audio: 0.2, audio: 0.4 },
        '1080p': { no_audio: 0.2, audio: 0.4 },
        '4k': { no_audio: 0.4, audio: 0.6 },
      },
    },
    {
      capabilities: ['text2video', 'image2video', 'reference2video'],
      refs: 3,
      resolutions: ['720p', '1080p', '4k'],
      durations: [4, 6, 8],
      audio: true,
      seed: true,
      tier: 'premium',
    },
  ),
  ...video(
    ['google/veo-3.1-fast'],
    'Veo 3.1 Fast',
    {
      kind: 'per_second_tiered',
      tiers: {
        '720p': { no_audio: 0.08, audio: 0.1 },
        '1080p': { no_audio: 0.1, audio: 0.12 },
        '4k': { no_audio: 0.25, audio: 0.3 },
      },
    },
    { resolutions: ['720p', '1080p', '4k'], durations: [4, 6, 8], audio: true, seed: true },
  ),
  ...video(
    ['google/veo-3.1-lite'],
    'Veo 3.1 Lite',
    {
      kind: 'per_second_tiered',
      tiers: { '720p': { no_audio: 0.03, audio: 0.05 }, '1080p': { no_audio: 0.05, audio: 0.08 } },
    },
    { resolutions: ['720p', '1080p'], durations: [4, 6, 8], audio: true, seed: true, tier: 'draft' },
  ),
  ...video(
    ['bytedance/seedance-2.5'],
    'Seedance 2.5',
    {
      kind: 'video_tokens',
      usd_per_token: { default: 0.0000107 },
      with_video_input: { default: 0.0000064 },
      fps: 24,
      divisor: 1024,
      fixed_usd: 0,
    },
    {
      capabilities: ['text2video', 'image2video', 'reference2video', 'video2video'],
      refs: 50,
      resolutions: ['480p', '720p'],
      durations: { min: 4, max: 30, step: 1 },
      audio: true,
      seed: true,
      tags: ['native-audio'],
    },
  ),
  ...video(
    ['bytedance/seedance-2.0'],
    'Seedance 2.0',
    {
      kind: 'video_tokens',
      usd_per_token: { default: 0.000007, '1080p': 0.0000077, '4k': 0.000004 },
      fps: 24,
      divisor: 1024,
      fixed_usd: 0,
    },
    {
      resolutions: ['480p', '720p', '1080p', '4k'],
      durations: { min: 4, max: 15, step: 1 },
      audio: true,
      seed: true,
    },
  ),
  ...video(
    ['bytedance/seedance-2.0-fast'],
    'Seedance 2.0 Fast',
    { kind: 'video_tokens', usd_per_token: { default: 0.0000042 }, fps: 24, divisor: 1024, fixed_usd: 0 },
    {
      resolutions: ['480p', '720p'],
      durations: { min: 4, max: 15, step: 1 },
      audio: true,
      seed: true,
      tier: 'draft',
    },
  ),
  ...video(
    ['bytedance/seedance-2.0-mini'],
    'Seedance 2.0 Mini',
    { kind: 'video_tokens', usd_per_token: { default: 0.0000035 }, fps: 24, divisor: 1024, fixed_usd: 0 },
    {
      resolutions: ['480p', '720p'],
      durations: { min: 4, max: 15, step: 1 },
      audio: true,
      seed: true,
      tier: 'draft',
    },
  ),
  ...video(
    ['kwaivgi/kling-v3.0-pro'],
    'Kling 3.0 Pro',
    {
      kind: 'per_second_tiered',
      tiers: { '720p': { no_audio: 0.112, audio: 0.168 }, '1080p': { no_audio: 0.112, audio: 0.168 } },
    },
    { resolutions: ['720p', '1080p'], durations: { min: 3, max: 15, step: 1 }, audio: true, tier: 'premium' },
  ),
  ...video(
    ['kwaivgi/kling-v3.0-std'],
    'Kling 3.0 Standard',
    { kind: 'per_second_tiered', tiers: { '720p': { no_audio: 0.084, audio: 0.126 } } },
    { resolutions: ['720p'], durations: { min: 3, max: 15, step: 1 }, audio: true },
  ),
  ...video(
    ['alibaba/wan-3.0'],
    'Wan 3.0',
    {
      kind: 'per_second_tiered',
      tiers: {
        '480p': { no_audio: 0.05, audio: 0.05 },
        '720p': { no_audio: 0.1, audio: 0.1 },
        '1080p': { no_audio: 0.2, audio: 0.2 },
      },
    },
    {
      resolutions: ['480p', '720p', '1080p'],
      durations: { min: 2, max: 30, step: 1 },
      audio: true,
      seed: true,
    },
  ),
  ...video(
    ['minimax/hailuo-3'],
    'MiniMax H3',
    {
      kind: 'per_second_tiered',
      tiers: { '2k': { no_audio: 0.13, audio: 0.13 } },
      ref_image_free: 0,
      ref_image_usd: 0.04,
    },
    { resolutions: ['2k'], durations: { min: 5, max: 15, step: 1 }, audio: true, refs: 12 },
  ),
  ...video(
    ['minimax/hailuo-3-max'],
    'MiniMax H3 Max',
    { kind: 'per_second_tiered', tiers: { '480p': { no_audio: 0.05 }, '768p': { no_audio: 0.08 } } },
    { resolutions: ['480p', '768p'], durations: { min: 5, max: 15, step: 1 }, tier: 'draft' },
  ),
  ...video(
    ['black-forest-labs/flux-video-edit'],
    'FLUX Video Edit',
    { kind: 'flat_per_unit', unit: 'second', amount: 0.03, extras: [] },
    {
      capabilities: ['video2video'],
      resolutions: ['720p', '1080p'],
      durations: { min: 1, max: 60, step: 1 },
    },
  ),
  ...video(
    ['black-forest-labs/flux-video-upscale'],
    'FLUX Video Upscale',
    { kind: 'per_megapixel', per_mp_usd: 0.075, count_inputs: false, round: 'exact' },
    {
      capabilities: ['upscale_video'],
      resolutions: ['1080p', '2k', '4k'],
      durations: { min: 1, max: 3600, step: 1 },
    },
  ),
  ...video(
    ['heygen/avatar-iv'],
    'HeyGen Avatar IV',
    { kind: 'flat_per_unit', unit: 'second', amount: 0.05, extras: [] },
    {
      capabilities: ['avatar'],
      refs: 1,
      resolutions: ['720p', '1080p'],
      durations: { min: 1, max: 300, step: 1 },
    },
  ),
  openrouter({
    model_id: 'anthropic/claude-sonnet-5',
    display_name: 'Claude Sonnet 5',
    capabilities: ['llm', 'vlm'],
    price_rule: { kind: 'per_million_tokens', in: 2, out: 10 },
    quality_tier: 'premium',
    supports: { resolutions: [], references_max: 8, aspect_ratios: ['auto'] },
    media_roles: referenceRoles(8),
    retention_days: null,
    moderation: { http: 403, shape: 'error.metadata.reasons', billed: 'no' },
    eta_s: 8,
  }),
  openrouter({
    model_id: 'openai/gpt-5.6-terra',
    display_name: 'GPT-5.6 Terra',
    capabilities: ['llm', 'vlm'],
    price_rule: { kind: 'per_million_tokens', in: 2, out: 12 },
    supports: { resolutions: [], references_max: 8, aspect_ratios: ['auto'] },
    media_roles: referenceRoles(8),
    retention_days: null,
    moderation: { http: 403, shape: 'error.metadata.reasons', billed: 'no' },
    eta_s: 8,
  }),
  openrouter({
    model_id: 'openai/gpt-5.6-luna',
    display_name: 'GPT-5.6 Luna',
    capabilities: ['llm', 'vlm'],
    price_rule: { kind: 'per_million_tokens', in: 0.2, out: 1.2 },
    quality_tier: 'draft',
    supports: { resolutions: [], references_max: 8, aspect_ratios: ['auto'] },
    media_roles: referenceRoles(8),
    retention_days: null,
    moderation: { http: 403, shape: 'error.metadata.reasons', billed: 'no' },
    eta_s: 5,
  }),
  openrouter({
    model_id: 'google/gemini-3.8-flash',
    display_name: 'Gemini 3.8 Flash',
    capabilities: ['llm', 'vlm'],
    price_rule: { kind: 'per_million_tokens', in: 0.75, out: 3.75 },
    supports: { resolutions: [], references_max: 8, aspect_ratios: ['auto'] },
    media_roles: referenceRoles(8, ['image', 'video', 'audio']),
    retention_days: null,
    moderation: { http: 403, shape: 'error.metadata.reasons', billed: 'no' },
    eta_s: 5,
  }),
  openrouter({
    model_id: 'openai/gpt-transcribe',
    display_name: 'GPT Transcribe',
    capabilities: ['stt'],
    price_rule: { kind: 'per_minute', amount: 0.0045, unit_of: 'input', per_target_language: false },
    supports: { resolutions: [], references_max: 0, aspect_ratios: ['auto'] },
    media_roles: [{ role: 'audio', min: 1, max: 1, kinds: ['audio'] }],
    retention_days: null,
    moderation: { http: 403, shape: 'error.metadata.reasons', billed: 'no' },
    eta_s: 20,
  }),
  openrouter({
    model_id: 'deepgram/nova-3',
    display_name: 'Deepgram Nova 3',
    capabilities: ['stt'],
    price_rule: { kind: 'per_minute', amount: 0.0043, unit_of: 'input', per_target_language: false },
    supports: { resolutions: [], references_max: 0, aspect_ratios: ['auto'] },
    media_roles: [{ role: 'audio', min: 1, max: 1, kinds: ['audio'] }],
    retention_days: null,
    moderation: { http: 403, shape: 'error.metadata.reasons', billed: 'no' },
    eta_s: 20,
  }),
];

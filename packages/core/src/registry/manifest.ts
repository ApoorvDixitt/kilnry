// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import * as z from 'zod';
import { CapabilitySchema, MediaRoleSchema, ProviderIdSchema } from '../types.js';

export const ResolutionSchema = z.enum([
  '480p',
  '720p',
  '768p',
  '768P',
  '1080p',
  '2k',
  '2K',
  '4k',
  '4K',
  '0.5K',
  '1K',
]);
export type Resolution = z.infer<typeof ResolutionSchema>;

const PriceExtraSchema = z.object({
  label: z.string(),
  extra: z.string(),
  usd: z.number().nonnegative(),
});

export const PriceRuleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('free'), unit: z.string().default('image') }),
  z.object({
    kind: z.literal('flat_per_unit'),
    unit: z.enum(['image', 'second', 'run', 'clone', 'generation']),
    amount: z.number().nonnegative(),
    by: z
      .object({
        key: z.enum(['resolution', 'quality', 'rendering_speed', 'style', 'audio']),
        table: z.record(z.string(), z.number().nonnegative()),
      })
      .optional(),
    extras: z.array(PriceExtraSchema).default([]),
  }),
  z.object({
    kind: z.literal('per_megapixel'),
    first_mp_usd: z.number().nonnegative().optional(),
    per_mp_usd: z.number().nonnegative(),
    count_inputs: z.boolean().default(false),
    round: z.enum(['ceil_each', 'ceil_total', 'exact']).default('ceil_each'),
  }),
  z.object({
    kind: z.literal('per_second_tiered'),
    tiers: z.record(
      z.string(),
      z.object({
        no_audio: z.number().nonnegative(),
        audio: z.number().nonnegative().optional(),
        voice: z.number().nonnegative().optional(),
      }),
    ),
    elements_multiplier: z.number().positive().optional(),
    ref_image_free: z.number().int().nonnegative().optional(),
    ref_image_usd: z.number().nonnegative().optional(),
    ref_video_per_s: z.record(z.string(), z.number().nonnegative()).optional(),
    fps60_multiplier: z.number().positive().optional(),
    round_up_to_s: z.number().positive().optional(),
    min_charge_usd: z.number().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal('video_tokens'),
    usd_per_token: z.record(z.string(), z.number().nonnegative()),
    fps: z.number().positive().default(24),
    divisor: z.number().positive().default(1024),
    with_video_input: z.record(z.string(), z.number().nonnegative()).optional(),
    fixed_usd: z.number().nonnegative().default(0),
  }),
  z.object({
    kind: z.literal('image_tokens'),
    table: z.record(z.string(), z.record(z.string(), z.number().nonnegative())),
    rates: z.object({
      image_out: z.number().nonnegative(),
      image_in: z.number().nonnegative(),
      text_in: z.number().nonnegative(),
      text_out: z.number().nonnegative().optional(),
    }),
    input_tokens_per_ref: z.number().nonnegative().default(3050),
  }),
  z.object({
    kind: z.literal('output_tokens_table'),
    tokens_by_size: z.record(z.string(), z.number().nonnegative()),
    usd_per_token: z.number().nonnegative(),
    input_usd_per_token: z.number().nonnegative().optional(),
    input_tokens_per_image: z.number().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal('per_million_tokens'),
    in: z.number().nonnegative(),
    out: z.number().nonnegative(),
    cached_in: z.number().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal('per_1k_chars'),
    amount: z.number().nonnegative(),
    first_use_usd: z.number().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal('per_minute'),
    amount: z.number().nonnegative(),
    unit_of: z.enum(['input', 'output']),
    per_target_language: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal('per_step'),
    usd_per_step: z.number().nonnegative(),
    min_steps: z.number().int().nonnegative().optional(),
    ref_multiplier: z.record(z.string(), z.number().positive()).optional(),
  }),
  z.object({
    kind: z.literal('per_compute_second'),
    usd_per_s: z.number().nonnegative(),
    typical_s: z.number().nonnegative(),
  }),
  z.object({
    kind: z.literal('provider_estimate'),
    endpoint: z.enum(['higgsfield_estimate', 'wavespeed_pricing', 'fal_pricing']),
    fallback: z.unknown(),
  }),
]);
export type PriceRule = z.infer<typeof PriceRuleSchema>;

export const PriceSnapshotSchema = z.object({
  rule: PriceRuleSchema,
  fetched_at: z.string().datetime(),
  source: z.enum([
    'seed',
    'fal_pricing_api',
    'openrouter_endpoints',
    'openrouter_models',
    'openrouter_videos',
    'provider_estimate',
    'manual',
  ]),
  source_url: z.string().url(),
});
export type PriceSnapshot = z.infer<typeof PriceSnapshotSchema>;

export const SupportsSchema = z.object({
  negative_prompt: z.boolean().default(false),
  seed: z.boolean().default(false),
  audio: z.boolean().default(false),
  references_max: z.number().int().nonnegative().default(0),
  lora: z.boolean().default(false),
  identity_ids: z.array(z.literal('higgsfield_soul_id')).default([]),
  voice_ids: z.boolean().default(false),
  elements: z.boolean().default(false),
  start_end_frame: z.boolean().default(false),
  multi_shot: z.boolean().default(false),
  resolutions: z.array(ResolutionSchema).default([]),
  aspect_ratios: z.array(z.string()).default(['auto']),
  durations: z
    .union([
      z.array(z.number().positive()),
      z.object({
        min: z.number().positive(),
        max: z.number().positive(),
        step: z.number().positive().default(1),
      }),
    ])
    .optional(),
});
export type Supports = z.infer<typeof SupportsSchema>;

export const ModelManifestSchema = z.object({
  provider: ProviderIdSchema,
  model_id: z.string().min(1),
  display_name: z.string().min(1),
  capabilities: z.array(CapabilitySchema).min(1),
  supports: SupportsSchema,
  media_roles: z
    .array(
      z.object({
        role: MediaRoleSchema,
        min: z.number().int().nonnegative().default(0),
        max: z.number().int().nonnegative(),
        kinds: z.array(z.enum(['image', 'video', 'audio'])).default(['image']),
      }),
    )
    .default([]),
  params_schema: z.record(z.string(), z.unknown()).default({}),
  price_rule: PriceRuleSchema,
  retention_days: z.number().int().nonnegative().nullable(),
  moderation: z.object({
    http: z.number().int().nullable(),
    shape: z.string(),
    billed: z.enum(['no', 'maybe', 'yes']),
  }),
  quality_tier: z.enum(['draft', 'standard', 'premium']),
  eta_s: z.number().int().nonnegative().default(30),
  tags: z.array(z.string()).default([]),
  training_on_inputs: z.boolean().default(false),
  concurrency_override: z.number().int().positive().optional(),
  enabled: z.boolean().default(true),
  deprecated_at: z.string().datetime().nullable().default(null),
  deprecation_note: z.string().optional(),
  source_url: z.string().url(),
  seeded_at: z.string().datetime(),
});
export type ModelManifest = z.infer<typeof ModelManifestSchema>;

export function parsePriceRule(value: unknown): PriceRule {
  const parsed = PriceRuleSchema.parse(value);
  return parsed.kind === 'provider_estimate'
    ? { ...parsed, fallback: parsePriceRule(parsed.fallback) }
    : parsed;
}

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import * as z from 'zod';

export const ProviderIdSchema = z.enum([
  'fal',
  'openrouter',
  'google',
  'openai',
  'elevenlabs',
  'minimax',
  'higgsfield',
  'replicate',
  'kie',
  'wavespeed',
  'ollama',
  'pollinations',
]);
export type ProviderId = z.infer<typeof ProviderIdSchema>;

export const CapabilitySchema = z.enum([
  'text2image',
  'image_edit',
  'text2video',
  'image2video',
  'reference2video',
  'video2video',
  'motion_transfer',
  'lipsync',
  'avatar',
  'tts',
  'voice_clone',
  'stt',
  'music',
  'sfx',
  'upscale_image',
  'upscale_video',
  'bg_remove',
  'reframe_image',
  'reframe_video',
  'outpaint',
  '3d',
  'vlm',
  'llm',
  'face_embed',
  'train_lora',
  'train_identity',
]);
export type Capability = z.infer<typeof CapabilitySchema>;

export const KindSchema = z.enum(['image', 'video', 'audio', '3d', 'image_edit', 'video_edit']);
export type Kind = z.infer<typeof KindSchema>;

export const MediaRoleSchema = z.enum([
  'start_frame',
  'end_frame',
  'reference',
  'style',
  'product',
  'audio',
  'video',
  'mask',
  'driving_video',
]);
export type MediaRole = z.infer<typeof MediaRoleSchema>;

export const StrategySchema = z.enum([
  'lora',
  'identity_id',
  'elements',
  'reference_images',
  'start_frame',
  'voice_id',
  'text',
]);
export type Strategy = z.infer<typeof StrategySchema>;

export const JobStatusSchema = z.enum([
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
  'moderated',
  'waiting',
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const CanonicalParamsSchema = z
  .object({
    aspect_ratio: z.string().optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    resolution: z.string().optional(),
    duration_s: z.number().positive().optional(),
    seed: z.number().int().optional(),
    quality: z.enum(['draft', 'standard', 'premium']).optional(),
    audio: z.boolean().optional(),
    language: z.string().optional(),
    voice: z.object({ provider: ProviderIdSchema, voice_id: z.string() }).optional(),
    extra: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const CanonicalRequestSchema = z.object({
  kind: KindSchema,
  capability: CapabilitySchema,
  prompt: z.string().min(1).max(20_000),
  negative_prompt: z.string().max(10_000).optional(),
  params: CanonicalParamsSchema.default({}),
  medias: z
    .array(
      z.object({
        role: MediaRoleSchema,
        asset_id: z.string().optional(),
        url: z.string().url().optional(),
        path: z.string().optional(),
        label: z.string().optional(),
        weight: z.number().min(0).max(1).optional(),
      }),
    )
    .default([]),
  injections: z
    .array(
      z.object({
        handle: z.string(),
        version: z.number().int().positive(),
        strategy: StrategySchema,
        inputs: z.array(z.string()),
      }),
    )
    .default([]),
  count: z.number().int().min(1).max(4).default(1),
  target_folder: z.string().default('inbox'),
  source: z.enum(['ui', 'chat', 'mcp', 'workflow', 'preset']).default('ui'),
});
export type CanonicalRequest = z.infer<typeof CanonicalRequestSchema>;

export interface EstimateBreakdown {
  label: string;
  usd: number;
}

export interface UnitPrice {
  unit: string;
  amount_usd: number;
  fetched_at: string;
  source_url: string;
}

export interface Estimate {
  estimate_usd: number;
  authoritative_usd?: number;
  source: 'formula' | 'provider';
  unit_price: UnitPrice;
  breakdown: EstimateBreakdown[];
  route: { provider: ProviderId; model: string; why: string };
  adjustments: string[];
  eta_s: number;
}

export function capabilityFor(kind: Kind, medias: Array<{ role: MediaRole }>): Capability {
  if (kind === 'image_edit') return 'image_edit';
  if (kind === 'video_edit') return 'video2video';
  if (kind === '3d') return '3d';
  if (kind === 'audio') return 'tts';
  if (kind === 'video') {
    if (medias.some((media) => media.role === 'reference' || media.role === 'product')) {
      return 'reference2video';
    }
    if (medias.some((media) => media.role === 'start_frame')) return 'image2video';
    return 'text2video';
  }
  return 'text2image';
}

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The preset file format (F-PRE-03, TRD-12 §12). A preset is one shot: a single
// model, a prompt scaffold with named slots the drawer turns into a form, the
// parameters to send, and an indicative price. It is a file first — the database
// only indexes it — so a preset can be read, edited and shared as text.
//
// Two rules keep a preset honest. The prompt may only name slots that the preset
// declares, so a form can never leave a placeholder unfilled. And a character or
// element slot renders as its @handle, never as a picture, so the one resolver
// decides how a likeness reaches a provider.
//
// Unknown top-level keys are kept rather than dropped, so a preset written for a
// later version of Kilnry survives a round trip through this one.

import { CapabilitySchema, MediaRoleSchema, ProviderIdSchema } from '@kilnry/core';
import * as z from 'zod';

/** The tabs the catalogue shows (F-PRE-01). */
export const PresetCategorySchema = z.enum([
  'ugc',
  'product_shot',
  'motion',
  'ads',
  'posters',
  'camera',
  'styles',
  'thumbnails',
]);
export type PresetCategory = z.infer<typeof PresetCategorySchema>;

/** What a preset produces. */
export const PresetKindSchema = z.enum(['image', 'video', 'audio', 'image_edit', 'video_edit']);
export type PresetKind = z.infer<typeof PresetKindSchema>;

/** The form controls a slot can be (TRD-12 §12). */
export const PresetSlotTypeSchema = z.enum([
  'media',
  'character',
  'voice',
  'text',
  'number',
  'enum',
  'color',
]);
export type PresetSlotType = z.infer<typeof PresetSlotTypeSchema>;

/** One input the drawer asks for. */
export const PresetSlotSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
  type: PresetSlotTypeSchema,
  label: z.string(),
  required: z.boolean().default(false),
  default: z.unknown().optional(),
  roles: z.array(MediaRoleSchema).optional(),
  accept: z.array(z.enum(['image', 'video', 'audio'])).optional(),
  kinds: z.array(z.enum(['character', 'prop', 'environment', 'style'])).optional(),
  options: z.array(z.string()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  help: z.string().optional(),
});
export type PresetSlot = z.infer<typeof PresetSlotSchema>;

/** What the router may not deviate from when a preset names constraints. */
const PresetConstraintsSchema = z
  .object({
    quality: z.string().optional(),
    refs_count: z.number().optional(),
    needs_audio: z.boolean().optional(),
    duration_s: z.number().optional(),
    min_resolution: z.string().optional(),
  })
  .partial();

/** The preset file. Unknown top-level keys are preserved (PRD-09 §3 rule 2). */
export const PresetJsonSchema = z
  .object({
    schema_version: z.literal(1),
    id: z
      .string()
      .regex(/^[a-z0-9][a-z0-9.-]{2,79}$/, 'an id is lower-case letters, digits, dots and hyphens'),
    name: z.string().max(60),
    version: z.string(),
    description: z.string().max(1024),
    category: PresetCategorySchema,
    kind: PresetKindSchema,
    capability: CapabilitySchema,
    model: z.object({
      id: z.string(),
      locked: z.boolean().default(false),
      alternates: z.array(z.string()).default([]),
      constraints: PresetConstraintsSchema.optional(),
    }),
    prompt: z.string().max(4000),
    negative_prompt: z.string().max(1000).optional(),
    params: z.record(z.string(), z.unknown()).default({}),
    slots: z.array(PresetSlotSchema).default([]),
    medias: z.array(z.object({ role: MediaRoleSchema, from_slot: z.string() })).default([]),
    count: z.number().int().min(1).max(4).default(1),
    indicative_cost_usd: z.number().optional(),
    needs: z.array(ProviderIdSchema).default([]),
    examples: z
      .array(z.object({ asset_url: z.string(), inputs: z.record(z.string(), z.unknown()).default({}) }))
      .default([]),
    tags: z.array(z.string()).default([]),
    license: z.string().default('CC0-1.0'),
    author: z.string().optional(),
    workflow: z.object({ id: z.string(), inputs: z.record(z.string(), z.unknown()).default({}) }).optional(),
  })
  .loose();

export type PresetJson = z.infer<typeof PresetJsonSchema>;

/** The largest a preset file may be (TRD-12 §12). */
export const MAX_PRESET_BYTES = 64 * 1024;

/** Provider prompt tokens a preset must never hard-code (D-16, TRD-12 §12). */
export const PROVIDER_PROMPT_TOKENS = ['@Element', '<<<', '>>>'];

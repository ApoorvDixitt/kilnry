// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import {
  ModelManifestSchema,
  type ModelManifest,
  type PriceRule,
  type Resolution,
  type Supports,
} from '../manifest.js';
import type { Capability, MediaRole, ProviderId } from '../../types.js';

export const SEEDED_AT = '2026-09-19T00:00:00.000Z';

interface SeedInput {
  provider: ProviderId;
  model_id: string;
  display_name: string;
  capabilities: Capability[];
  price_rule: PriceRule;
  quality_tier?: 'draft' | 'standard' | 'premium';
  supports?: Partial<Supports>;
  media_roles?: Array<{
    role: MediaRole;
    min?: number;
    max: number;
    kinds?: Array<'image' | 'video' | 'audio'>;
  }>;
  retention_days?: number | null;
  moderation?: { http: number | null; shape: string; billed: 'no' | 'maybe' | 'yes' };
  eta_s?: number;
  tags?: string[];
  training_on_inputs?: boolean;
  concurrency_override?: number;
  enabled?: boolean;
  deprecated_at?: string | null;
  deprecation_note?: string;
  source_url: string;
}

const defaultSupports: Supports = {
  negative_prompt: false,
  seed: false,
  audio: false,
  references_max: 0,
  lora: false,
  identity_ids: [],
  voice_ids: false,
  elements: false,
  start_end_frame: false,
  multi_shot: false,
  resolutions: ['1K'],
  aspect_ratios: ['auto'],
};

export function seed(input: SeedInput): ModelManifest {
  return ModelManifestSchema.parse({
    provider: input.provider,
    model_id: input.model_id,
    display_name: input.display_name,
    capabilities: input.capabilities,
    supports: { ...defaultSupports, ...input.supports },
    media_roles: input.media_roles ?? [],
    params_schema: { type: 'object', additionalProperties: false },
    price_rule: input.price_rule,
    retention_days: input.retention_days ?? 7,
    moderation: input.moderation ?? { http: 422, shape: 'content_policy_violation', billed: 'maybe' },
    quality_tier: input.quality_tier ?? 'standard',
    eta_s: input.eta_s ?? 30,
    tags: input.tags ?? [],
    training_on_inputs: input.training_on_inputs ?? false,
    ...(input.concurrency_override ? { concurrency_override: input.concurrency_override } : {}),
    enabled: input.enabled ?? true,
    deprecated_at: input.deprecated_at ?? null,
    ...(input.deprecation_note ? { deprecation_note: input.deprecation_note } : {}),
    source_url: input.source_url,
    seeded_at: SEEDED_AT,
  });
}

export function videoSupports(
  options: {
    resolutions?: Resolution[];
    durations?: number[] | { min: number; max: number; step?: number };
    audio?: boolean;
    references?: number;
    elements?: boolean;
    voiceIds?: boolean;
    startEnd?: boolean;
    seed?: boolean;
    negative?: boolean;
    aspects?: string[];
  } = {},
): Partial<Supports> {
  const durationInput = options.durations ?? { min: 3, max: 15, step: 1 };
  const durations = Array.isArray(durationInput)
    ? durationInput
    : { ...durationInput, step: durationInput.step ?? 1 };
  return {
    resolutions: options.resolutions ?? ['720p'],
    durations,
    audio: options.audio ?? false,
    references_max: options.references ?? 0,
    elements: options.elements ?? false,
    voice_ids: options.voiceIds ?? false,
    start_end_frame: options.startEnd ?? false,
    seed: options.seed ?? false,
    negative_prompt: options.negative ?? false,
    aspect_ratios: options.aspects ?? ['16:9', '9:16', '1:1'],
  };
}

export function referenceRoles(
  maximum: number,
  kinds: Array<'image' | 'video' | 'audio'> = ['image'],
): Array<{
  role: MediaRole;
  min?: number;
  max: number;
  kinds?: Array<'image' | 'video' | 'audio'>;
}> {
  return maximum > 0 ? [{ role: 'reference', min: 0, max: maximum, kinds }] : [];
}

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import type { ModelManifest, PriceSnapshot } from '../manifest.js';
import { falSeed } from './fal.js';
import { goldenSupportSeed } from './other-goldens.js';
import { openrouterSeed } from './openrouter.js';
import { remainingProvidersSeed } from './remaining-providers.js';

const pollinationsSeed: ModelManifest = {
  provider: 'pollinations',
  model_id: 'flux',
  display_name: 'FLUX (demo)',
  capabilities: ['text2image'],
  supports: {
    negative_prompt: false,
    seed: true,
    audio: false,
    references_max: 0,
    lora: false,
    identity_ids: [],
    voice_ids: false,
    elements: false,
    start_end_frame: false,
    multi_shot: false,
    resolutions: ['1K'],
    aspect_ratios: ['1:1', '16:9', '9:16'],
  },
  media_roles: [],
  params_schema: {
    type: 'object',
    properties: {
      aspect_ratio: { type: 'string', enum: ['1:1', '16:9', '9:16'] },
      resolution: { type: 'string', enum: ['1K'] },
      seed: { type: 'integer', minimum: 0 },
      quality: { type: 'string', enum: ['draft'] },
    },
    additionalProperties: false,
  },
  price_rule: { kind: 'free', unit: 'image' },
  retention_days: null,
  moderation: { http: 403, shape: 'error', billed: 'no' },
  quality_tier: 'draft',
  eta_s: 8,
  tags: ['demo'],
  training_on_inputs: false,
  enabled: true,
  deprecated_at: null,
  source_url: 'https://gen.pollinations.ai/docs',
  seeded_at: '2026-09-19T00:00:00.000Z',
};

export const registrySeed: readonly ModelManifest[] = [
  ...falSeed,
  ...openrouterSeed,
  pollinationsSeed,
  ...goldenSupportSeed,
  ...remainingProvidersSeed,
];

export function seedSnapshot(model: ModelManifest): PriceSnapshot {
  return {
    rule: model.price_rule,
    fetched_at: model.seeded_at,
    source: 'seed',
    source_url: model.source_url,
  };
}

export function seedSnapshotMap(models: readonly ModelManifest[] = registrySeed): Map<string, PriceSnapshot> {
  return new Map(models.map((model) => [`${model.provider}:${model.model_id}`, seedSnapshot(model)]));
}

export function seedModel(provider: string, modelId: string): ModelManifest | undefined {
  return registrySeed.find((model) => model.provider === provider && model.model_id === modelId);
}

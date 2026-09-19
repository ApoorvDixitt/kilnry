// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import type { ApiEstimate, ApiModel } from '../lib/composer-types';

// Full manifest support flags so test fixtures satisfy the core Supports shape
// without every test repeating all fifteen fields.
export function fullSupports(overrides: Partial<ApiModel['supports']> = {}): ApiModel['supports'] {
  return {
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
    ...overrides,
  };
}

export function makeModel(overrides: Partial<ApiModel> = {}): ApiModel {
  const base: ApiModel = {
    provider: 'fal',
    model_id: 'fal-ai/example',
    display_name: 'Example',
    capabilities: ['text2image'],
    supports: fullSupports(),
    media_roles: [],
    params_schema: {},
    price_rule: { kind: 'flat_per_unit', unit: 'image', amount: 0.15, extras: [] },
    retention_days: 7,
    moderation: { http: 422, shape: 'content_policy_violation', billed: 'maybe' },
    quality_tier: 'standard',
    eta_s: 30,
    tags: [],
    training_on_inputs: false,
    enabled: true,
    deprecated_at: null,
    source_url: 'https://example.com/model',
    seeded_at: '2026-09-19T00:00:00.000Z',
    connected: true,
    price: { unit: 'image', amount_usd: 0.15, fetched_at: '2026-09-17T00:00:00.000Z' },
  };
  return { ...base, ...overrides, supports: fullSupports(overrides.supports) };
}

export function makeEstimate(overrides: Partial<ApiEstimate> = {}): ApiEstimate {
  return {
    estimate_usd: 0.84,
    source: 'formula',
    unit_price: {
      unit: 'second',
      amount_usd: 0.168,
      fetched_at: '2026-09-17T00:00:00.000Z',
      source_url: 'https://example.com/price',
    },
    breakdown: [{ label: '$0.168/s x 5 s x 1', usd: 0.84 }],
    route: { provider: 'fal', model: 'fal-ai/example', why: 'cheapest connected route' },
    adjustments: [],
    eta_s: 90,
    ...overrides,
  };
}

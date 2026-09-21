// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import * as z from 'zod';
import {
  CanonicalRequestSchema,
  KindSchema,
  MediaRoleSchema,
  capabilityFor,
  type CanonicalRequest,
  type RouteConstraints,
} from '@kilnry/core';

export const GenerationInput = z.object({
  kind: KindSchema.default('image'),
  prompt: z.string().min(1).max(20_000),
  negative_prompt: z.string().max(10_000).optional(),
  model: z.string().default('auto'),
  params: z.record(z.string(), z.unknown()).default({}),
  medias: z
    .array(
      z.object({
        role: MediaRoleSchema,
        asset_id: z.string().optional(),
        url: z.string().url().optional(),
        path: z.string().optional(),
      }),
    )
    .default([]),
  count: z.number().int().min(1).max(4).default(1),
  target_folder: z.string().default('inbox'),
  confirmed_cost_usd: z.number().nonnegative().optional(),
  client_request_id: z.string().min(1).max(64).optional(),
  override_budget: z.boolean().default(false),
  allow_stale_price: z.boolean().default(false),
  // A preset run is an ordinary job that remembers where it came from (D-26).
  source: z.enum(['ui', 'preset']).default('ui'),
  preset_id: z.string().min(1).max(80).optional(),
});
export type GenerationInputValue = z.infer<typeof GenerationInput>;

export function canonicalGeneration(input: GenerationInputValue): {
  request: CanonicalRequest;
  constraints: RouteConstraints;
} {
  const params = {
    ...input.params,
    extra:
      typeof input.params.extra === 'object' && input.params.extra !== null
        ? (input.params.extra as Record<string, unknown>)
        : {},
  };
  const request = CanonicalRequestSchema.parse({
    kind: input.kind,
    capability: capabilityFor(input.kind, input.medias),
    prompt: input.prompt,
    ...(input.negative_prompt === undefined ? {} : { negative_prompt: input.negative_prompt }),
    params,
    medias: input.medias,
    injections: [],
    count: input.count,
    target_folder: input.target_folder,
    source: input.source,
  });
  return {
    request,
    constraints: {
      ...(input.model === 'auto' ? {} : { pinned_model: input.model }),
      needs_audio: Boolean(request.params.audio),
      refs_count: request.medias.filter((media) => ['reference', 'product'].includes(media.role)).length,
      ...(request.params.duration_s === undefined ? {} : { duration_s: request.params.duration_s }),
      ...(request.params.aspect_ratio === undefined ? {} : { aspect_ratio: request.params.aspect_ratio }),
    },
  };
}

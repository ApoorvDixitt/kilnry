// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextResponse } from 'next/server';
import * as z from 'zod';
import { KilnryError, castGenerationPrompts, type CastParams } from '@kilnry/core';
import { errorResponse, requireSession } from '../../../../server/http';

const Body = z.object({
  archetype: z.enum([
    'creator/host',
    'expert',
    'customer-demo',
    'storyteller',
    'mascot',
    'athlete',
    'executive',
    'student',
    'parent',
    'villain',
  ]),
  age_range: z.enum(['18-24', '25-34', '35-44', '45-54', '55+']),
  look: z.enum(['photoreal', 'editorial', 'anime-2d', '3d-stylised', 'game-concept', 'claymation']),
  region: z.string().max(120).optional(),
  wardrobe: z.enum(['casual', 'smart-casual', 'traditional', 'sportswear', 'uniform', 'formal']),
  vibe: z.enum(['warm and approachable', 'deadpan', 'energetic', 'authoritative', 'mysterious']),
  setting_hint: z.string().max(120).optional(),
  model: z.string().optional(),
});

// Build the cast prompts for one anchor and three alternates (F-CHR-15). The age
// gate lives in castGenerationPrompts, which throws on a minor. This route
// returns the prompts and the payload the composer uses to generate the four
// images through the ordinary estimate-then-generate path; it does not spend.
export async function POST(request: Request): Promise<Response> {
  try {
    await requireSession();
    const body = Body.parse(await request.json());
    const params: CastParams = {
      archetype: body.archetype,
      age_range: body.age_range,
      look: body.look,
      wardrobe: body.wardrobe,
      vibe: body.vibe,
      ...(body.region ? { region: body.region } : {}),
      ...(body.setting_hint ? { setting_hint: body.setting_hint } : {}),
    };
    let prompts;
    try {
      prompts = castGenerationPrompts(params);
    } catch (error) {
      if (error instanceof KilnryError) return errorResponse(error);
      throw error;
    }
    // The composer generates the anchor with count 4 (anchor + three alternates
    // are variants of one prompt); the alternate prompts are returned so a caller
    // that prefers explicit variants can use them instead.
    return NextResponse.json({
      params,
      anchor_prompt: prompts.anchor,
      alternate_prompts: prompts.alternates,
      generate: {
        kind: 'image',
        prompt: prompts.anchor,
        model: body.model ?? 'auto',
        count: 4,
        params: {},
        source: 'ui',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

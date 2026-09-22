// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextResponse } from 'next/server';
import * as z from 'zod';
import {
  CanonicalRequestSchema,
  KilnryError,
  capabilityFor,
  findModelManifest,
  loadRegistry,
  resolvePromptFromDb,
  type Kind,
} from '@kilnry/core';
import { errorResponse, requireSession } from '../../../../server/http';
import { runtimeServices } from '../../../../server/runtime';

const Body = z.object({
  prompt: z.string().min(1).max(20_000),
  model: z.string().optional(),
  kind: z.enum(['image', 'video', 'audio', '3d', 'image_edit', 'video_edit']).default('image'),
  characters: z.array(z.string()).optional(),
});

// Show exactly what a prompt resolves to for the chosen model — the hover preview
// on a mention chip (F-CHR-09). Read-only; never spends.
export async function POST(request: Request): Promise<Response> {
  try {
    await requireSession();
    const body = Body.parse(await request.json());
    const services = await runtimeServices();
    const kind = body.kind as Kind;

    let model;
    if (body.model) {
      model = await findModelManifest(services.database, body.model);
    } else {
      const registry = await loadRegistry(services.database);
      const wantCapability = capabilityFor(kind, []);
      model = registry.models.find((m) => m.capabilities.includes(wantCapability)) ?? registry.models[0];
      if (!model) throw new KilnryError('NO_PROVIDER', 'No model is available to preview against.');
    }

    const req = {
      ...CanonicalRequestSchema.parse({
        kind,
        capability: capabilityFor(kind, []),
        prompt: body.prompt,
      }),
      ...(body.characters ? { characters: body.characters } : {}),
    };
    const resolved = await resolvePromptFromDb(services.database, req, model);
    return NextResponse.json({
      resolution: {
        rewritten_prompt: resolved.prompt,
        injections: resolved.injections.map((i) => ({
          handle: i.handle,
          version: i.version,
          strategy: i.strategy,
          inputs: i.inputs.map((input) => ({ role: input.role, asset_id: input.asset_id })),
          ...(i.is_real_person ? { is_real_person: true } : {}),
          ...(i.consent_status ? { consent_status: i.consent_status } : {}),
          notes: i.notes,
        })),
        warnings: resolved.warnings,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Fill a preset in and price it (F-PRE-02). The drawer sends the slot values and
// gets back the resolved prompt, parameters and media bindings together with the
// engine's estimate. Two things follow from doing it here rather than in the
// browser: the prompt previewed is byte for byte the prompt Run sends, and the
// price still comes from the one estimator every other spend goes through
// (D-26). Nothing is charged by this route; it only prices.

import { NextResponse } from 'next/server';
import { KilnryError, listProviders, registrySeed } from '@kilnry/core';
import { chooseModel, getPreset, renderPreset, usesCharacterAnchor } from '@kilnry/presets';
import { adapters } from '@kilnry/providers';
import * as z from 'zod';
import { errorResponse, requireSession } from '../../../../../server/http';
import { presetRoots } from '../../../../../server/presets';
import { canonicalGeneration, GenerationInput } from '../../../../../server/generation-input';
import { ensureRuntimeEngine, runtimeServices } from '../../../../../server/runtime';

const ResolveInput = z.object({
  values: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
  model: z.string().optional(),
  target_folder: z.string().optional(),
});

/** The folder a preset asks its results to land in, when it names one. */
function folderHint(preset: Record<string, unknown>): string | undefined {
  const hint = preset.target_folder_hint;
  return typeof hint === 'string' && hint !== '' ? hint : undefined;
}

/** Which provider serves a model reference, by the shipped registry. */
function providerOf(ref: string): string | undefined {
  for (const model of registrySeed) {
    if (model.model_id === ref || `${model.provider}/${model.model_id}` === ref) return model.provider;
  }
  return undefined;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireSession();
    const { id } = await context.params;
    const input = ResolveInput.parse(await request.json());
    const entry = getPreset(id, await presetRoots());
    if (!entry || !entry.preset) {
      throw new KilnryError('NOT_FOUND', `No preset called ${id} is installed.`);
    }
    const preset = entry.preset;
    const resolved = renderPreset(preset, input.values);
    const anchor = usesCharacterAnchor(preset);

    // Which model the run will actually use: what the user picked, else the first
    // hint a connected provider can serve (F-PRE-06). A camera preset is priced
    // at the video price of that model, so the hint must be settled first.
    const services = await runtimeServices();
    const summaries = await listProviders(services.database, adapters);
    const connected = new Set(summaries.filter((row) => row.connected).map((row) => row.id));
    const chosen =
      input.model === undefined
        ? chooseModel(preset, { connected, providerOf })
        : { model: input.model, reason: 'primary' as const };

    // A preset with an empty required slot is previewed but not priced: there is
    // no request to price yet, and the drawer says which field is missing.
    if (resolved.missing.length > 0 || resolved.prompt.trim() === '') {
      return NextResponse.json({ resolved, estimate: null, model: chosen, anchor });
    }

    const payload = GenerationInput.parse({
      kind: preset.kind,
      prompt: resolved.prompt,
      ...(resolved.negative_prompt === undefined ? {} : { negative_prompt: resolved.negative_prompt }),
      model: chosen.model,
      params: resolved.params,
      medias: resolved.medias.map((media) => ({ role: media.role, asset_id: media.ref })),
      count: resolved.count,
      target_folder: input.target_folder ?? folderHint(preset) ?? 'inbox',
      source: 'preset',
      preset_id: preset.id,
    });
    const canonical = canonicalGeneration(payload);
    const engine = await ensureRuntimeEngine();
    // The engine answers with the routed request and its estimate; the drawer's
    // cost strip wants the estimate itself.
    const priced = await engine.estimate(canonical.request, canonical.constraints);
    return NextResponse.json({ resolved, estimate: priced.estimate, model: chosen, anchor });
  } catch (error) {
    return errorResponse(error);
  }
}

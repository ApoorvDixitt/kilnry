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

import { join } from 'node:path';
import { NextResponse } from 'next/server';
import { KilnryError, loadConfig } from '@kilnry/core';
import { getPreset, renderPreset } from '@kilnry/presets';
import * as z from 'zod';
import { errorResponse, requireSession } from '../../../../../server/http';
import { canonicalGeneration, GenerationInput } from '../../../../../server/generation-input';
import { ensureRuntimeEngine } from '../../../../../server/runtime';

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

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireSession();
    const { id } = await context.params;
    const input = ResolveInput.parse(await request.json());
    const config = await loadConfig();
    const entry = getPreset(id, { user: join(config.data_dir, 'presets') });
    if (!entry || !entry.preset) {
      throw new KilnryError('NOT_FOUND', `No preset called ${id} is installed.`);
    }
    const preset = entry.preset;
    const resolved = renderPreset(preset, input.values);

    // A preset with an empty required slot is previewed but not priced: there is
    // no request to price yet, and the drawer says which field is missing.
    if (resolved.missing.length > 0 || resolved.prompt.trim() === '') {
      return NextResponse.json({ resolved, estimate: null });
    }

    const payload = GenerationInput.parse({
      kind: preset.kind,
      prompt: resolved.prompt,
      ...(resolved.negative_prompt === undefined ? {} : { negative_prompt: resolved.negative_prompt }),
      model: input.model ?? preset.model.id,
      params: resolved.params,
      medias: resolved.medias.map((media) => ({ role: media.role, asset_id: media.ref })),
      count: resolved.count,
      target_folder: input.target_folder ?? folderHint(preset) ?? 'inbox',
      source: 'preset',
      preset_id: preset.id,
    });
    const canonical = canonicalGeneration(payload);
    const engine = await ensureRuntimeEngine();
    const estimate = await engine.estimate(canonical.request, canonical.constraints);
    return NextResponse.json({ resolved, estimate });
  } catch (error) {
    return errorResponse(error);
  }
}

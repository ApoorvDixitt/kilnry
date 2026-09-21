// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The preset catalogue the gallery shows (F-PRE-01). The list is generated from
// the folders, not the database: the seed catalogue that ships with Kilnry, then
// the user folder, so an edited copy of a seed wins. Each row carries what the
// card draws — the model tag, the indicative cost, whether a key is still
// missing, and whether the price behind that cost has gone stale.

import { join } from 'node:path';
import { NextResponse } from 'next/server';
import { listProviders, loadConfig, registrySeed } from '@kilnry/core';
import { listPresets } from '@kilnry/presets';
import { adapters } from '@kilnry/providers';
import { errorResponse, requireSession } from '../../../server/http';
import { runtimeServices } from '../../../server/runtime';

export interface PresetCardRow {
  id: string;
  name: string;
  category: string;
  description: string;
  tags: string[];
  kind: string;
  model_label: string;
  model_tooltip: string;
  cost_usd?: number;
  cost_unit: string;
  needs: string[];
  missing_provider?: string;
  price_stale: boolean;
  preview_url?: string;
  enabled: boolean;
  issue?: string;
  path: string;
  source: string;
}

/** The display name the registry gives a model reference, else the reference. */
function modelName(ref: string): string {
  if (ref === 'auto') return 'Auto';
  for (const model of registrySeed) {
    if (model.model_id === ref || `${model.provider}/${model.model_id}` === ref) {
      return model.display_name;
    }
  }
  return ref;
}

/** Which provider serves a model reference, for the locked-to tooltip. */
function modelProvider(ref: string): string | undefined {
  for (const model of registrySeed) {
    if (model.model_id === ref || `${model.provider}/${model.model_id}` === ref) return model.provider;
  }
  return undefined;
}

export async function GET(): Promise<Response> {
  try {
    await requireSession();
    const services = await runtimeServices();
    const summaries = await listProviders(services.database, adapters);
    const connected = new Set(summaries.filter((row) => row.connected).map((row) => row.id));
    const stale = new Set(summaries.filter((row) => row.price_stale).map((row) => row.id));
    const config = await loadConfig();

    const rows: PresetCardRow[] = listPresets({
      user: join(config.data_dir, 'presets'),
    }).map((entry) => {
      const preset = entry.preset;
      const refs = preset ? [preset.model.id, ...preset.model.alternates] : [];
      const provider = preset ? modelProvider(preset.model.id) : undefined;
      const alternates = refs.slice(1).map(modelName);
      const missing =
        preset && preset.needs.length > 0 && !preset.needs.some((id) => connected.has(id))
          ? preset.needs[0]
          : undefined;
      return {
        id: entry.id,
        name: preset?.name ?? entry.id,
        category: entry.category,
        description: preset?.description ?? '',
        tags: preset?.tags ?? [],
        kind: preset?.kind ?? 'image',
        model_label: preset ? modelName(preset.model.id) : '',
        model_tooltip: preset
          ? `${preset.model.locked ? 'Locked to' : 'Prefers'} ${modelName(preset.model.id)}${
              provider ? ` on ${provider}` : ''
            }${alternates.length > 0 ? ` · alternates: ${alternates.join(', ')}` : ''}`
          : '',
        ...(preset?.indicative_cost_usd === undefined ? {} : { cost_usd: preset.indicative_cost_usd }),
        cost_unit: preset?.kind === 'video' ? 'clip' : 'image',
        needs: preset?.needs ?? [],
        ...(missing === undefined ? {} : { missing_provider: missing }),
        price_stale: (preset?.needs ?? []).some((id) => stale.has(id)),
        ...(preset?.examples[0]?.asset_url === undefined
          ? {}
          : { preview_url: preset.examples[0].asset_url }),
        enabled: entry.enabled,
        ...(entry.issues[0] === undefined ? {} : { issue: entry.issues[0].message }),
        path: entry.path,
        source: entry.source,
      };
    });

    return NextResponse.json({ presets: rows });
  } catch (error) {
    return errorResponse(error);
  }
}

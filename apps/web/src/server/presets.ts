// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Where presets come from, in one place (F-PRE-04). Three roots, read in this
// order so a later one shadows an earlier one by identifier: the catalogue that
// ships with Kilnry, the user's own folder, then the presets a skill brought
// with it when it was installed. Skills that ship presets therefore appear in
// the catalogue without any extra import step.

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { settings, type DatabaseState } from '@kilnry/db';
import { loadConfig, type PresetCatalogueServices, type PresetSummary } from '@kilnry/core';
import { getPreset, listPresets, renderPreset, type PresetRoots } from '@kilnry/presets';

// The owner can disable an installed preset; a disabled preset is hidden from the
// catalogue grid and the kilnry_presets list (PRD-09). The disabled ids persist
// in the settings key/value table so no preset schema change is needed.
const DISABLED_PRESETS_KEY = 'presets.disabled';

/** The set of preset ids the owner has disabled. */
export async function disabledPresetIds(db: DatabaseState): Promise<Set<string>> {
  const rows = await db.db.select().from(settings).where(eq(settings.key, DISABLED_PRESETS_KEY)).limit(1);
  const value = rows[0]?.value;
  return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []);
}

/** Enable or disable a preset by id, persisted in the settings table. */
export async function setPresetEnabled(db: DatabaseState, id: string, enabled: boolean): Promise<void> {
  const current = await disabledPresetIds(db);
  if (enabled) current.delete(id);
  else current.add(id);
  const value = [...current];
  await db.db
    .insert(settings)
    .values({ key: DISABLED_PRESETS_KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

/** The folder a user's own presets live in. */
export function userPresetRoot(dataDir: string): string {
  return join(dataDir, 'presets');
}

/** Every `presets` folder an installed skill brought with it. */
export function skillPresetRoots(dataDir: string): string[] {
  const skills = join(dataDir, 'skills');
  try {
    return readdirSync(skills, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(skills, entry.name, 'presets'));
  } catch {
    return [];
  }
}

/** The roots to read, in shadowing order. */
export async function presetRoots(): Promise<PresetRoots> {
  const config = await loadConfig();
  return { user: userPresetRoot(config.data_dir), skill: skillPresetRoots(config.data_dir) };
}

function summarise(entry: ReturnType<typeof listPresets>[number]): PresetSummary {
  const preset = entry.preset;
  return {
    id: entry.id,
    name: preset?.name ?? entry.id,
    category: entry.category,
    description: preset?.description ?? '',
    kind: preset?.kind ?? 'image',
    model: preset?.model.id ?? 'auto',
    ...(preset?.indicative_cost_usd === undefined ? {} : { indicative_cost_usd: preset.indicative_cost_usd }),
    slots: (preset?.slots ?? []).map((slot) => ({
      name: slot.name,
      type: slot.type,
      label: slot.label,
      required: slot.required,
    })),
    needs: preset?.needs ?? [],
    source: entry.source,
    enabled: entry.enabled,
  };
}

/** The folder a preset asks its results to land in, when it names one. */
function folderHint(preset: Record<string, unknown>): string | undefined {
  const hint = preset.target_folder_hint;
  return typeof hint === 'string' && hint !== '' ? hint : undefined;
}

/**
 * The catalogue the kilnry_presets tool reads. It is handed to the tool rather
 * than imported by it, because the preset package depends on the core package
 * the tools live in.
 */
export async function presetServices(db?: DatabaseState): Promise<PresetCatalogueServices> {
  const roots = await presetRoots();
  const disabled = db ? await disabledPresetIds(db) : new Set<string>();
  return {
    list(query) {
      const needle = query?.query?.trim().toLowerCase() ?? '';
      return listPresets(roots)
        .filter((entry) => !disabled.has(entry.id))
        .filter((entry) => query?.category === undefined || entry.category === query.category)
        .filter((entry) => {
          if (needle === '') return true;
          const preset = entry.preset;
          const haystack = [entry.id, preset?.name ?? '', preset?.description ?? '', ...(preset?.tags ?? [])]
            .join(' ')
            .toLowerCase();
          return haystack.includes(needle);
        })
        .map(summarise);
    },
    get(id) {
      if (disabled.has(id)) return undefined;
      const entry = getPreset(id, roots);
      return entry ? summarise(entry) : undefined;
    },
    resolve(id, values) {
      if (disabled.has(id)) return undefined;
      const entry = getPreset(id, roots);
      if (!entry?.preset) return undefined;
      const preset = entry.preset;
      const resolved = renderPreset(preset, values);
      const hint = folderHint(preset);
      return {
        kind: preset.kind,
        model: preset.model.id,
        prompt: resolved.prompt,
        ...(resolved.negative_prompt === undefined ? {} : { negative_prompt: resolved.negative_prompt }),
        params: resolved.params,
        medias: resolved.medias,
        count: resolved.count,
        missing: resolved.missing,
        ...(hint === undefined ? {} : { target_folder: hint }),
      };
    },
  };
}

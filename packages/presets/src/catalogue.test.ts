// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The shipped preset catalogue, checked in the build (F-PRE-05). A preset that
// does not validate fails here rather than in front of a paying request, and the
// dual-provider rule is checked too: every seed must be runnable by somebody who
// has only a fal key and by somebody who has only an OpenRouter key, so the
// catalogue is useful on the first key a user connects.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CanonicalRequestSchema, registrySeed, route, seedSnapshotMap } from '@kilnry/core';
import { describe, expect, it } from 'vitest';
import { PresetCategorySchema } from './schema.js';
import { validatePresetFile } from './validate.js';

// The canonical catalogue: packages/skills/presets/<category>/<id>.json (TRD-03 §10).
const catalogue = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills', 'presets');

interface Shipped {
  category: string;
  fileName: string;
  path: string;
  text: string;
}

function shippedPresets(): Shipped[] {
  const out: Shipped[] = [];
  let categories: string[];
  try {
    categories = readdirSync(catalogue).filter((entry) => statSync(join(catalogue, entry)).isDirectory());
  } catch {
    return out;
  }
  for (const category of categories) {
    const dir = join(catalogue, category);
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      const path = join(dir, file);
      out.push({ category, fileName: file.replace(/\.json$/, ''), path, text: readFileSync(path, 'utf8') });
    }
  }
  return out;
}

const presets = shippedPresets();

describe('the shipped preset catalogue (F-PRE-05)', () => {
  it('ships at least one preset', () => {
    expect(presets.length).toBeGreaterThan(0);
  });

  it.each(presets.map((preset) => [`${preset.category}/${preset.fileName}`, preset] as const))(
    'validates %s with no errors',
    (_label, preset) => {
      const { preset: parsed, issues } = validatePresetFile(preset.text, preset.fileName);
      const errors = issues.filter((issue) => issue.level === 'error');
      expect(errors, errors.map((issue) => `${issue.rule}: ${issue.message}`).join('; ')).toEqual([]);
      expect(parsed).toBeDefined();
    },
  );

  it.each(presets.map((preset) => [`${preset.category}/${preset.fileName}`, preset] as const))(
    'files %s under the folder that matches its category',
    (_label, preset) => {
      const { preset: parsed } = validatePresetFile(preset.text, preset.fileName);
      expect(parsed?.category).toBe(preset.category);
      expect(PresetCategorySchema.safeParse(preset.category).success).toBe(true);
    },
  );

  it.each(presets.map((preset) => [`${preset.category}/${preset.fileName}`, preset] as const))(
    'lets %s run with only a fal key and with only an OpenRouter key',
    (_label, preset) => {
      const { preset: parsed } = validatePresetFile(preset.text, preset.fileName);
      expect(parsed?.needs).toContain('fal');
      expect(parsed?.needs).toContain('openrouter');
      // A route can only be found if the model is chosen for the connected key.
      expect(parsed?.model.id).toBe('auto');
      expect((parsed?.model.alternates ?? []).length).toBeGreaterThan(0);
    },
  );

  it('gives every preset a unique identifier across the catalogue', () => {
    const ids = presets.map((preset) => preset.fileName);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// The acceptance criterion behind F-PRE-05: a seed must find a route with only
// one of the two starter keys connected. This routes each preset for real,
// against the shipped registry, with one provider connected at a time.
describe('every seed routes on a single starter key (F-PRE-05)', () => {
  const soleProvider = (provider: 'fal' | 'openrouter'): Parameters<typeof route>[2] => ({
    models: [...registrySeed],
    snapshots: seedSnapshotMap(),
    providers: { [provider]: { connected: true, status: 'ok' } },
  });

  for (const shipped of presets) {
    const { preset } = validatePresetFile(shipped.text, shipped.fileName);
    for (const provider of ['fal', 'openrouter'] as const) {
      it(`${shipped.category}/${shipped.fileName} routes with only ${provider}`, () => {
        expect(preset).toBeDefined();
        // The same canonical request the run path builds, minus the slot values.
        const request = CanonicalRequestSchema.parse({
          kind: preset!.kind,
          capability: preset!.capability,
          prompt: 'dry run',
          params: {},
          medias: [],
          injections: [],
          count: preset!.count,
        });
        const result = route(request, {}, soleProvider(provider));
        expect(result.provider).toBe(provider);
        expect(result.model_id).toBeTruthy();
      });
    }
  }
});

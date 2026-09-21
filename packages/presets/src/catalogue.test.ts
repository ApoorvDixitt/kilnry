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
import { join } from 'node:path';
import { CanonicalRequestSchema, registrySeed, route, seedSnapshotMap } from '@kilnry/core';
import { describe, expect, it } from 'vitest';
import { getPreset, listPresets, loadPresets, seedCatalogueRoot } from './loader.js';
import { PresetCategorySchema } from './schema.js';
import { validatePresetFile } from './validate.js';

// The shipped catalogue lives beside its loader: packages/presets/catalogue.
const catalogue = seedCatalogueRoot();

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

// The seed catalogue PRD-09 §5 specifies, in its order: 5.1 UGC, 5.2 product
// shot, 5.3 motion, 5.4 ads, 5.5 posters, 5.6 camera, 5.7 styles, 5.8
// thumbnails. The identifier carries the category as the section names it, so
// `kilnry.product.*` files sit in the `product_shot` folder.
const SPECIFIED: ReadonlyArray<readonly [id: string, category: string]> = [
  ['kilnry.ugc.creator-selfie', 'ugc'],
  ['kilnry.ugc.hand-demo-clip', 'ugc'],
  ['kilnry.ugc.pov-unboxing', 'ugc'],
  ['kilnry.ugc.talking-head-9x16', 'ugc'],
  ['kilnry.ugc.on-my-desk', 'ugc'],
  ['kilnry.product.clean-packshot', 'product_shot'],
  ['kilnry.product.ice-cube-splash', 'product_shot'],
  ['kilnry.product.floating-hero', 'product_shot'],
  ['kilnry.product.marble-lifestyle', 'product_shot'],
  ['kilnry.product.hands-closeup', 'product_shot'],
  ['kilnry.product.flat-lay', 'product_shot'],
  ['kilnry.product.ghost-mannequin', 'product_shot'],
  ['kilnry.motion.turntable-spin', 'motion'],
  ['kilnry.motion.liquid-pour', 'motion'],
  ['kilnry.motion.steam-rise', 'motion'],
  ['kilnry.motion.fabric-flow', 'motion'],
  ['kilnry.motion.logo-reveal', 'motion'],
  ['kilnry.ads.square-headline-space', 'ads'],
  ['kilnry.ads.side-by-side', 'ads'],
  ['kilnry.ads.quote-card-bg', 'ads'],
  ['kilnry.ads.carousel-slide', 'ads'],
  ['kilnry.ads.story-9x16', 'ads'],
  ['kilnry.poster.event-typographic', 'posters'],
  ['kilnry.poster.minimal-object', 'posters'],
  ['kilnry.poster.retro-travel', 'posters'],
  ['kilnry.poster.cinematic-one-sheet', 'posters'],
  ['kilnry.camera.dolly-in', 'camera'],
  ['kilnry.camera.dolly-out', 'camera'],
  ['kilnry.camera.orbit-360', 'camera'],
  ['kilnry.camera.crash-zoom', 'camera'],
  ['kilnry.camera.handheld-walk', 'camera'],
  ['kilnry.camera.fpv-drone', 'camera'],
  ['kilnry.camera.whip-pan', 'camera'],
  ['kilnry.camera.top-down-crane', 'camera'],
  ['kilnry.style.paper-cutout', 'styles'],
  ['kilnry.style.claymation', 'styles'],
  ['kilnry.style.editorial-collage', 'styles'],
  ['kilnry.thumb.reaction-object', 'thumbnails'],
  ['kilnry.thumb.before-after', 'thumbnails'],
  ['kilnry.thumb.big-number', 'thumbnails'],
];

/** Which providers serve a model reference, by the registry the app ships. */
function providersFor(ref: string): string[] {
  const found = new Set<string>();
  for (const model of registrySeed) {
    if (model.model_id === ref || `${model.provider}/${model.model_id}` === ref) found.add(model.provider);
  }
  return [...found];
}

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
    'names a route on both starter providers for %s',
    (_label, preset) => {
      const { preset: parsed } = validatePresetFile(preset.text, preset.fileName);
      expect(parsed?.needs).toContain('fal');
      expect(parsed?.needs).toContain('openrouter');
      // The primary and its alternates must between them name a real model on
      // fal and on OpenRouter, so neither starter key leaves the card unusable.
      const refs = [parsed!.model.id, ...parsed!.model.alternates];
      const providers = new Set(refs.flatMap((ref) => providersFor(ref)));
      expect([...providers].sort(), `unknown or single-provider models: ${refs.join(', ')}`).toEqual(
        expect.arrayContaining(['fal', 'openrouter']),
      );
    },
  );

  it('gives every preset a unique identifier across the catalogue', () => {
    const ids = presets.map((preset) => preset.fileName);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // PRD-09 §5 names all forty seeds. Nothing else may ship, every file must sit
  // in the folder the section puts it in, and once the count reaches forty the
  // catalogue has to be the specified set exactly.
  it('ships only presets PRD-09 §5 specifies, in the category it gives them', () => {
    const expected = new Map(SPECIFIED);
    for (const preset of presets) {
      expect(expected.has(preset.fileName), `${preset.fileName} is not in PRD-09 §5`).toBe(true);
      expect(expected.get(preset.fileName)).toBe(preset.category);
    }
  });

  it('is the complete set of forty once every batch has landed', () => {
    if (presets.length < SPECIFIED.length) {
      // Batches land one commit at a time; report what is still missing.
      const shipped = new Set(presets.map((preset) => preset.fileName));
      const missing = SPECIFIED.filter(([id]) => !shipped.has(id)).map(([id]) => id);
      expect(missing.length).toBe(SPECIFIED.length - presets.length);
      return;
    }
    expect(presets.map((preset) => preset.fileName).sort()).toEqual(SPECIFIED.map(([id]) => id).sort());
  });
});

describe('the preset loader (TRD-03 §4a)', () => {
  it('reads the seed catalogue that ships beside it', () => {
    const loaded = listPresets();
    expect(loaded.length).toBe(presets.length);
    expect(loaded.every((entry) => entry.source === 'seed')).toBe(true);
    expect(loaded.every((entry) => entry.enabled)).toBe(true);
  });

  it('files each seed under the category the file declares', () => {
    for (const entry of listPresets()) {
      expect(entry.path).toContain(join('catalogue', entry.category));
    }
  });

  it('finds one preset by its identifier', () => {
    expect(getPreset('kilnry.product.ice-cube-splash')?.category).toBe('product_shot');
    expect(getPreset('not-a-preset')).toBeUndefined();
  });

  it('lets a later source shadow a seed of the same identifier', () => {
    // The user folder is read after the seed, so an edited copy wins.
    const byId = loadPresets({ user: join(seedCatalogueRoot(), 'ugc') });
    expect(byId.get('kilnry.ugc.creator-selfie')?.source).toBe('user');
    expect(byId.get('kilnry.product.ice-cube-splash')?.source).toBe('seed');
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

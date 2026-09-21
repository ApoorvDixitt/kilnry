// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Finding presets on disk (F-PRE-03, TRD-03 §4a). Three places are read, in this
// order, and a later one shadows an earlier one of the same identifier:
//
//   seed     the catalogue shipped beside this loader
//   user     ~/.kilnry/presets, where an imported or edited preset lands
//   skill    a preset a skill brought with it (the F-PRE-04 import path)
//
// A preset that fails validation is listed as disabled with its first error
// rather than dropped, so the catalogue can say why something will not run
// instead of quietly missing it.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PresetJson } from './schema.js';
import { validatePresetFile, type PresetIssue } from './validate.js';

/** Where a preset was found, which decides what the catalogue may do with it. */
export type PresetSource = 'seed' | 'user' | 'skill';

export interface LoadedPreset {
  id: string;
  category: string;
  source: PresetSource;
  path: string;
  enabled: boolean;
  preset?: PresetJson;
  issues: PresetIssue[];
}

export interface PresetRoots {
  /** The shipped catalogue. Defaults to the folder beside this loader. */
  seed?: string;
  /** The user's own folder, normally ~/.kilnry/presets. */
  user?: string;
  /** Folders a skill shipped presets in (F-PRE-04). */
  skill?: string[];
}

/**
 * The shipped seed catalogue: packages/presets/catalogue. It sits beside this
 * loader so the files and the code that reads them ship and version together.
 */
export function seedCatalogueRoot(): string {
  // src/loader.ts → packages/presets ; dist/loader.js → packages/presets
  const here = dirname(fileURLToPath(import.meta.url));
  const parent = resolve(here, '..');
  return existsSync(join(parent, 'catalogue')) ? join(parent, 'catalogue') : join(here, 'catalogue');
}

function readOne(path: string, fileName: string, category: string, source: PresetSource): LoadedPreset {
  const { preset, issues } = validatePresetFile(readFileSync(path, 'utf8'), fileName);
  return {
    id: fileName,
    category: preset?.category ?? category,
    source,
    path,
    enabled: preset !== undefined,
    ...(preset ? { preset } : {}),
    issues,
  };
}

function readCategory(dir: string, category: string, source: PresetSource): LoadedPreset[] {
  const out: LoadedPreset[] = [];
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return out;
  }
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    out.push(readOne(join(dir, file), file.replace(/\.json$/, ''), category, source));
  }
  return out;
}

function readRoot(root: string, source: PresetSource): LoadedPreset[] {
  const out: LoadedPreset[] = [];
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const path = join(root, entry);
    let isDirectory: boolean;
    try {
      isDirectory = statSync(path).isDirectory();
    } catch {
      continue;
    }
    // Presets are filed by category folder. A loose file is accepted too, since
    // that is what dropping one preset into your own folder gives you; its
    // category then comes from the file itself.
    if (isDirectory) out.push(...readCategory(path, entry, source));
    else if (entry.endsWith('.json')) out.push(readOne(path, entry.replace(/\.json$/, ''), '', source));
  }
  return out;
}

/**
 * Load every preset Kilnry can see, newest source winning on a clash. Returns
 * them by identifier so the catalogue and the tool read the same view.
 */
export function loadPresets(roots: PresetRoots = {}): Map<string, LoadedPreset> {
  const byId = new Map<string, LoadedPreset>();
  const ordered: Array<[PresetSource, string]> = [
    ['seed', roots.seed ?? seedCatalogueRoot()],
    ...(roots.user ? ([['user', roots.user]] as Array<[PresetSource, string]>) : []),
    ...((roots.skill ?? []).map((dir) => ['skill', dir]) as Array<[PresetSource, string]>),
  ];
  for (const [source, root] of ordered) {
    for (const loaded of readRoot(root, source)) byId.set(loaded.id, loaded);
  }
  return byId;
}

/** Every preset that can run, in catalogue order (category then identifier). */
export function listPresets(roots: PresetRoots = {}): LoadedPreset[] {
  return [...loadPresets(roots).values()].sort(
    (a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id),
  );
}

/** One preset by identifier, or undefined when it is missing or invalid. */
export function getPreset(id: string, roots: PresetRoots = {}): LoadedPreset | undefined {
  return loadPresets(roots).get(id);
}

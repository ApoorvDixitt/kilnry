// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Turning the composer into a preset (F-CRE-12). The work is deciding what
// becomes a slot: every attachment and every mention in the prompt is offered as
// a candidate, and the ones the user ticks are cut out of the prompt and left as
// placeholders. Everything here is a pure function so the dialog can be checked
// without a browser, and so the scaffold shown is the scaffold saved.

/** One thing the composer is holding that could become a slot. */
export interface SlotCandidate {
  /** How it appears now: an attachment id or a mention handle. */
  source: 'attachment' | 'mention';
  /** The handle for a mention, the asset id for an attachment. */
  value: string;
  /** The media role an attachment fills, when it has one. */
  role?: string;
  /** Whether the user ticked "Make this a slot". */
  chosen: boolean;
  /** The slot name, pre-filled and editable. */
  name: string;
  required: boolean;
}

/** The catalogue categories a preset may be filed under (F-PRE-01 tabs). */
export const SAVE_CATEGORIES = [
  'ugc',
  'product_shot',
  'motion',
  'ads',
  'posters',
  'camera',
  'styles',
  'thumbnails',
] as const;

/** Every mention in a prompt, in order, without repeats. */
export function mentionsIn(prompt: string): string[] {
  const found: string[] = [];
  for (const match of prompt.matchAll(/@([a-z0-9][a-z0-9_-]{1,31})/gi)) {
    const handle = match[1];
    if (handle !== undefined && !found.includes(handle)) found.push(handle);
  }
  return found;
}

/**
 * A slot name from a role or a handle. Names are lower-case letters and
 * underscores only, which is what PRD-05 §12 acceptance 2 asks for.
 */
export function slotNameFor(candidate: { source: string; role?: string; value: string }): string {
  const base = candidate.source === 'attachment' ? `${candidate.role ?? 'reference'}_image` : candidate.value;
  const name = base
    .toLowerCase()
    .replace(/[^a-z]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return name === '' ? 'input' : name;
}

/** Make the ticked names unique, appending _2, _3 where they collide. */
export function uniqueNames(candidates: SlotCandidate[]): SlotCandidate[] {
  const taken = new Set<string>();
  return candidates.map((candidate) => {
    if (!candidate.chosen) return candidate;
    let name = candidate.name;
    for (let suffix = 2; taken.has(name); suffix += 1) name = `${candidate.name}_${suffix}`;
    taken.add(name);
    return { ...candidate, name };
  });
}

/** The candidates a composer state offers, attachments first then mentions. */
export function candidatesFor(state: {
  prompt: string;
  medias?: Array<{ role: string; asset_id?: string }>;
}): SlotCandidate[] {
  const candidates: SlotCandidate[] = [];
  for (const media of state.medias ?? []) {
    if (media.asset_id === undefined) continue;
    const base = { source: 'attachment' as const, value: media.asset_id, role: media.role };
    candidates.push({ ...base, chosen: true, required: true, name: slotNameFor(base) });
  }
  for (const handle of mentionsIn(state.prompt)) {
    const base = { source: 'mention' as const, value: handle };
    candidates.push({ ...base, chosen: true, required: false, name: slotNameFor(base) });
  }
  return uniqueNames(candidates);
}

/**
 * The prompt with every chosen mention replaced by its placeholder. An
 * attachment leaves no mark in the prompt, so only mentions rewrite it.
 */
export function scaffoldPrompt(prompt: string, candidates: SlotCandidate[]): string {
  let scaffold = prompt;
  for (const candidate of candidates) {
    if (!candidate.chosen || candidate.source !== 'mention') continue;
    scaffold = scaffold.replaceAll(`@${candidate.value}`, `{{ ${candidate.name} }}`);
  }
  return scaffold;
}

/** A file-name-safe slug from a preset name. */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'preset'
  );
}

/**
 * The identifier, which is also the file name: author, category and slug, the
 * shape PRD-09 §3 gives community presets.
 */
export function presetIdFor(author: string, category: string, name: string): string {
  return `${slugify(author)}.${category}.${slugify(name)}`;
}

/** The name a collision is offered under: "Ice cube hover" becomes "… 2". */
export function nextName(name: string): string {
  const match = /^(.*) (\d+)$/.exec(name);
  if (match?.[1] !== undefined && match[2] !== undefined) return `${match[1]} ${Number(match[2]) + 1}`;
  return `${name} 2`;
}

/** What the save route needs to write a preset (F-CRE-12). */
export interface SaveDraft {
  name: string;
  category: string;
  description: string;
  kind: string;
  prompt: string;
  model: string;
  /** The model the composer was on, kept as a hint when Auto is chosen. */
  model_hint?: string;
  params: Record<string, unknown>;
  count: number;
  candidates: SlotCandidate[];
  example_asset_id?: string;
}

/** Whether Save may be pressed: a name, a scaffold, and usable slot names. */
export function canSave(draft: SaveDraft): boolean {
  if (draft.name.trim() === '' || draft.name.length > 60) return false;
  if (draft.description.length > 200) return false;
  if (draft.prompt.trim() === '') return false;
  if (!SAVE_CATEGORIES.includes(draft.category as (typeof SAVE_CATEGORIES)[number])) return false;
  const chosen = draft.candidates.filter((candidate) => candidate.chosen);
  if (chosen.some((candidate) => !/^[a-z_]+$/.test(candidate.name))) return false;
  return new Set(chosen.map((candidate) => candidate.name)).size === chosen.length;
}

/**
 * The preset file the composer becomes. A ticked attachment becomes a media slot
 * bound to the role it already filled; a ticked mention becomes a character slot
 * that renders as an @handle, so the one resolver still decides how a likeness
 * reaches a provider.
 */
export function buildPreset(draft: SaveDraft, author: string): Record<string, unknown> {
  const chosen = draft.candidates.filter((candidate) => candidate.chosen);
  const slots = chosen.map((candidate) =>
    candidate.source === 'attachment'
      ? {
          name: candidate.name,
          type: 'media',
          label: candidate.name.replaceAll('_', ' '),
          required: candidate.required,
          roles: [candidate.role ?? 'reference'],
          accept: ['image'],
        }
      : {
          name: candidate.name,
          type: 'character',
          label: candidate.name.replaceAll('_', ' '),
          required: candidate.required,
          kinds: ['character'],
        },
  );
  const medias = chosen
    .filter((candidate) => candidate.source === 'attachment')
    .map((candidate) => ({ role: candidate.role ?? 'reference', from_slot: candidate.name }));

  return {
    schema_version: 1,
    id: presetIdFor(author, draft.category, draft.name),
    name: draft.name.trim(),
    version: '1.0.0',
    description: draft.description.trim(),
    category: draft.category,
    kind: draft.kind,
    capability: capabilityFor(draft.kind, medias),
    model: {
      id: draft.model,
      locked: draft.model !== 'auto',
      alternates: [],
    },
    prompt: draft.prompt,
    params: draft.params,
    slots,
    medias,
    count: draft.count,
    needs: [],
    tags: [],
    license: 'CC0-1.0',
    author,
    // Auto keeps the model the composer was on, so the original choice is not
    // lost when the router is left to pick (PRD-05 §12 acceptance 4).
    ...(draft.model === 'auto' && draft.model_hint !== undefined ? { model_hint: draft.model_hint } : {}),
    ...(draft.example_asset_id === undefined
      ? {}
      : { examples: [{ asset_url: `/api/media/${draft.example_asset_id}`, inputs: {} }] }),
  };
}

/** The capability a kind and its bound media imply. */
function capabilityFor(kind: string, medias: Array<{ role: string }>): string {
  if (kind === 'image_edit') return 'image_edit';
  if (kind === 'video_edit') return 'video2video';
  if (kind === 'audio') return 'tts';
  if (kind === 'video') {
    if (medias.some((media) => media.role === 'reference' || media.role === 'product')) {
      return 'reference2video';
    }
    if (medias.some((media) => media.role === 'start_frame')) return 'image2video';
    return 'text2video';
  }
  return 'text2image';
}

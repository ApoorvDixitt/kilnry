// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The decisions the preset use drawer makes, kept out of the view so they can be
// tested on their own (F-PRE-02): which field a slot becomes, whether Run is
// blocked and why, what the model chip offers, and the read-only parameter line.
//
// Templating is deliberately not here. The drawer asks the server to resolve a
// preset, so the prompt it previews is the very payload Run sends and the two
// can never drift apart.

/** A slot as the drawer receives it from the API. */
export interface DrawerSlot {
  name: string;
  type: 'media' | 'character' | 'voice' | 'text' | 'number' | 'enum' | 'color';
  label: string;
  required: boolean;
  default?: unknown;
  roles?: string[];
  accept?: string[];
  kinds?: string[];
  options?: string[];
  min?: number;
  max?: number;
  help?: string;
}

/** The preset the drawer shows. */
export interface DrawerPreset {
  id: string;
  name: string;
  version: string;
  description: string;
  category: string;
  kind: string;
  capability: string;
  model: { id: string; locked: boolean; alternates: string[] };
  params: Record<string, unknown>;
  slots: DrawerSlot[];
  count: number;
  indicative_cost_usd?: number;
  license: string;
  author?: string;
  target_folder_hint?: string;
}

export type SlotValues = Record<string, string | number | undefined>;

/** The value a field starts with: the slot default, else empty. */
export function initialValues(preset: DrawerPreset): SlotValues {
  const values: SlotValues = {};
  for (const slot of preset.slots) {
    if (slot.default === undefined) continue;
    if (typeof slot.default === 'string' || typeof slot.default === 'number') {
      values[slot.name] = slot.default;
    }
  }
  return values;
}

/** Whether a slot has been given something usable. */
export function isFilled(value: string | number | undefined): boolean {
  if (value === undefined) return false;
  if (typeof value === 'number') return true;
  return value.trim() !== '';
}

/**
 * Which required slots are still empty. Run is blocked while this is not empty,
 * and each name gets an inline error; an optional slot with a default can never
 * appear here because the default already filled it (PRD-09 §2 acceptance 1).
 */
export function missingRequired(preset: DrawerPreset, values: SlotValues): string[] {
  return preset.slots
    .filter((slot) => slot.required && !isFilled(values[slot.name]))
    .map((slot) => slot.name);
}

/** Whether Run may be pressed at all. */
export function canRun(
  preset: DrawerPreset,
  values: SlotValues,
  state: { estimated: boolean; running: boolean; overBudget: boolean },
): boolean {
  if (state.running || !state.estimated || state.overBudget) return false;
  return missingRequired(preset, values).length === 0;
}

/** The model choices the chip offers: the primary, then its alternates. */
export function modelOptions(preset: DrawerPreset): string[] {
  const options = [preset.model.id, ...preset.model.alternates];
  // A preset that leaves the choice open offers Auto as well, so the router may
  // pick whatever the connected key can serve.
  if (!options.includes('auto')) options.push('auto');
  return [...new Set(options)];
}

/** Whether the drawer offers a Change control at all. */
export function canChangeModel(preset: DrawerPreset): boolean {
  return !preset.model.locked;
}

/** The read-only parameter line: aspect, resolution, duration and count. */
export function paramsSummary(params: Record<string, unknown>, count: number): string {
  const parts: string[] = [];
  const aspect = params.aspect_ratio;
  const resolution = params.resolution;
  const duration = params.duration_s;
  if (typeof aspect === 'string') parts.push(aspect);
  if (typeof resolution === 'string') parts.push(resolution);
  if (typeof duration === 'number') parts.push(`${duration} s`);
  parts.push(count === 1 ? '1 output' : `${count} outputs`);
  return parts.join(' · ');
}

/** The folder a run writes to: the preset hint when it has one, else the inbox. */
export function targetFolder(preset: DrawerPreset, current?: string): string {
  return preset.target_folder_hint ?? current ?? 'inbox';
}

/**
 * Everything Open in Create needs, as query parameters, so the composer opens
 * with the same prompt, model, parameters and attachments (acceptance 3).
 */
export function openInCreateQuery(input: {
  preset: DrawerPreset;
  model: string;
  resolved: { prompt: string; params: Record<string, unknown>; medias: Array<{ role: string; ref: string }> };
}): string {
  const query = new URLSearchParams({
    preset: input.preset.id,
    kind: input.preset.kind,
    prompt: input.resolved.prompt,
    model: input.model,
    params: JSON.stringify(input.resolved.params),
  });
  if (input.resolved.medias.length > 0) query.set('medias', JSON.stringify(input.resolved.medias));
  return query.toString();
}

/** The payload Run posts. It carries the resolved prompt, never a re-render. */
export function runPayload(input: {
  preset: DrawerPreset;
  model: string;
  resolved: {
    prompt: string;
    negative_prompt?: string;
    params: Record<string, unknown>;
    medias: Array<{ role: string; ref: string }>;
    count: number;
  };
  confirmedCostUsd: number;
  clientRequestId: string;
  currentFolder?: string;
}): Record<string, unknown> {
  return {
    kind: input.preset.kind,
    prompt: input.resolved.prompt,
    ...(input.resolved.negative_prompt === undefined
      ? {}
      : { negative_prompt: input.resolved.negative_prompt }),
    model: input.model,
    params: input.resolved.params,
    medias: input.resolved.medias.map((media) => ({ role: media.role, asset_id: media.ref })),
    count: input.resolved.count,
    target_folder: targetFolder(input.preset, input.currentFolder),
    source: 'preset',
    preset_id: input.preset.id,
    confirmed_cost_usd: input.confirmedCostUsd,
    client_request_id: input.clientRequestId,
  };
}

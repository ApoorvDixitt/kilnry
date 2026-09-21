// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Turning a filled-in preset into one request (F-PRE-03, TRD-12 §12). The drawer
// collects a value per slot; this renders the prompt, resolves the parameters,
// and binds the media roles, producing exactly what the generation path already
// takes — so a preset spends through the same estimate, budget and audit road as
// the composer, with nothing of its own.
//
// Two details matter. A character or element slot renders as its @handle so the
// resolver decides how a likeness is sent. And a parameter whose whole value is
// one placeholder keeps the slot's type, so a duration stays the number five
// rather than becoming the text "5".

import type { PresetJson, PresetSlot } from './schema.js';

/** What the user chose for each slot, keyed by slot name. */
export type SlotValues = Record<string, unknown>;

export interface RenderedPreset {
  prompt: string;
  negative_prompt?: string;
  params: Record<string, unknown>;
  /** The media inputs, bound from slots by role. */
  medias: Array<{ role: string; ref: string }>;
  count: number;
  /** Handles the resolver must expand, in the order they appear. */
  characters: string[];
  /** Slots that were required and left empty. */
  missing: string[];
}

const WHOLE_PLACEHOLDER = /^\s*\{\{\s*([a-z][a-z0-9_]*)\s*\}\}\s*$/;

/** A slot's effective value: what the user gave, else the preset's default. */
export function slotValue(slot: PresetSlot, values: SlotValues): unknown {
  const given = values[slot.name];
  if (given !== undefined && given !== '') return given;
  return slot.default;
}

/** How a slot reads inside a prompt. A likeness is always a handle. */
function asPromptText(slot: PresetSlot, value: unknown): string {
  if (value === undefined || value === null) return '';
  if (slot.type === 'character') {
    const handle = String(value);
    return handle.startsWith('@') ? handle : `@${handle}`;
  }
  return String(value);
}

/**
 * Render the prompt scaffold. Supports the placeholder `{{ slot }}` and the
 * conditional `{{#if slot}} … {{/if}}`, which drops its block when the slot is
 * empty so an optional note does not leave a dangling sentence.
 */
export function renderPrompt(template: string, preset: PresetJson, values: SlotValues): string {
  const bySlot = new Map(preset.slots.map((slot) => [slot.name, slot] as const));

  // Conditionals first, so a dropped block takes its placeholders with it.
  let text = template.replace(
    /\{\{#if\s+([a-z][a-z0-9_]*)\s*\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_all, name: string, body: string) => {
      const slot = bySlot.get(name);
      const value = slot ? slotValue(slot, values) : values[name];
      return value === undefined || value === null || value === '' ? '' : body;
    },
  );

  text = text.replace(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g, (_all, name: string) => {
    const slot = bySlot.get(name);
    if (!slot) return '';
    return asPromptText(slot, slotValue(slot, values));
  });

  // Tidy the spacing an emptied placeholder leaves behind.
  return text
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([.,;:!?])/g, '$1')
    .trim();
}

/**
 * Resolve the parameters. A value that is entirely one placeholder becomes the
 * slot's own value, keeping its type; a value with text around a placeholder is
 * rendered as text (TRD-12 §3).
 */
export function renderParams(preset: PresetJson, values: SlotValues): Record<string, unknown> {
  const bySlot = new Map(preset.slots.map((slot) => [slot.name, slot] as const));
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(preset.params)) {
    if (typeof value !== 'string') {
      out[key] = value;
      continue;
    }
    const whole = WHOLE_PLACEHOLDER.exec(value);
    if (whole) {
      const name = whole[1];
      const slot = name === undefined ? undefined : bySlot.get(name);
      const resolved = slot ? slotValue(slot, values) : undefined;
      // An unfilled parameter is left out rather than sent as an empty string.
      if (resolved !== undefined && resolved !== '') out[key] = resolved;
      continue;
    }
    out[key] = renderPrompt(value, preset, values);
  }
  return out;
}

/**
 * Render a preset into the one request it describes. Reports any required slot
 * left empty so the drawer can ask rather than the provider refusing.
 */
export function renderPreset(preset: PresetJson, values: SlotValues): RenderedPreset {
  const missing = preset.slots
    .filter((slot) => slot.required && isEmpty(slotValue(slot, values)))
    .map((slot) => slot.name);

  const medias: Array<{ role: string; ref: string }> = [];
  for (const binding of preset.medias) {
    const slot = preset.slots.find((entry) => entry.name === binding.from_slot);
    if (!slot) continue;
    const value = slotValue(slot, values);
    if (isEmpty(value)) continue;
    medias.push({ role: binding.role, ref: String(value) });
  }

  const characters = preset.slots
    .filter((slot) => slot.type === 'character')
    .map((slot) => slotValue(slot, values))
    .filter((value): value is string => typeof value === 'string' && value !== '')
    .map((handle) => (handle.startsWith('@') ? handle.slice(1) : handle));

  return {
    prompt: renderPrompt(preset.prompt, preset, values),
    ...(preset.negative_prompt === undefined
      ? {}
      : { negative_prompt: renderPrompt(preset.negative_prompt, preset, values) }),
    params: renderParams(preset, values),
    medias,
    count: preset.count,
    characters,
    missing,
  };
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

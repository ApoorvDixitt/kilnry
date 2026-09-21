// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Model hints (F-PRE-06). A camera or motion preset is a prompt scaffold, not a
// commitment to one provider: it names the model that renders the move best,
// then alternates in the order the author would fall back through. Its price is
// the video price of whichever model actually runs, so the hint has to be
// resolved before anything is estimated.
//
// Without this, a preset whose first hint sits on a provider the user has not
// connected would fail outright even though it lists a route the user can run.

import type { PresetJson } from './schema.js';

/** Why a model was chosen, so the drawer can say what it did. */
export type HintReason = 'primary' | 'alternate' | 'auto';

export interface ChosenModel {
  model: string;
  reason: HintReason;
}

/** The hints a preset offers, primary first, without the open choice. */
export function modelHints(preset: PresetJson): string[] {
  return [preset.model.id, ...preset.model.alternates].filter((ref) => ref !== 'auto');
}

/**
 * The first hint a connected provider can serve. A locked preset keeps its
 * model whatever happens, because locking it is the author saying the look
 * depends on that model. When no hint can run, the choice is left open and the
 * router picks from everything the connected keys offer.
 */
export function chooseModel(
  preset: PresetJson,
  context: { connected: ReadonlySet<string>; providerOf: (ref: string) => string | undefined },
): ChosenModel {
  if (preset.model.locked) return { model: preset.model.id, reason: 'primary' };
  const hints = modelHints(preset);
  for (const [index, ref] of hints.entries()) {
    const provider = context.providerOf(ref);
    if (provider !== undefined && context.connected.has(provider)) {
      return { model: ref, reason: index === 0 ? 'primary' : 'alternate' };
    }
  }
  return { model: 'auto', reason: 'auto' };
}

/**
 * Whether the resolver may use a Character's anchor image as the first frame
 * (PRD-09 §2). It applies to an image-to-video preset that asks for a Character
 * but never asks for a still: there is no other way to give the model a frame,
 * so the anchor stands in for one, and the drawer says so rather than leaving
 * the user to guess where the opening image came from.
 */
export function usesCharacterAnchor(preset: PresetJson): boolean {
  if (preset.capability !== 'image2video') return false;
  const hasCharacter = preset.slots.some((slot) => slot.type === 'character');
  if (!hasCharacter) return false;
  const hasStartFrame = preset.slots.some(
    (slot) => slot.type === 'media' && (slot.roles ?? []).includes('start_frame'),
  );
  return !hasStartFrame;
}

/** The media role a Character anchor fills when it stands in for a still. */
export const ANCHOR_ROLE = 'start_frame';

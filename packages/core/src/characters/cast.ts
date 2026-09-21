// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The cast builder (F-CHR-15, PRD-07 §15). It turns a few chosen traits into a
// prompt for one original cast member and three alternates. Two invariants are
// enforced here so no surface can bypass them: minors are never generated as
// characters, and every prompt states the person is original and resembles no
// real public figure.

import { KilnryError } from '../errors.js';

export type Archetype =
  | 'creator/host'
  | 'expert'
  | 'customer-demo'
  | 'storyteller'
  | 'mascot'
  | 'athlete'
  | 'executive'
  | 'student'
  | 'parent'
  | 'villain';

export type AgeRange = '18-24' | '25-34' | '35-44' | '45-54' | '55+';
export type Look = 'photoreal' | 'editorial' | 'anime-2d' | '3d-stylised' | 'game-concept' | 'claymation';
export type Wardrobe = 'casual' | 'smart-casual' | 'traditional' | 'sportswear' | 'uniform' | 'formal';
export type Vibe = 'warm and approachable' | 'deadpan' | 'energetic' | 'authoritative' | 'mysterious';

export interface CastParams {
  archetype: Archetype;
  age_range: AgeRange;
  look: Look;
  region?: string;
  wardrobe: Wardrobe;
  vibe: Vibe;
  setting_hint?: string;
}

// The clause every cast prompt carries (PRD-07 §15).
export const ORIGINAL_PERSON_CLAUSE = 'an original person who does not resemble any real public figure';

// Kilnry's realism module for photoreal looks: it reads as a real photograph, not
// a beauty-filtered render.
const REALISM_CLAUSE =
  'visible skin pores and natural asymmetry, matte skin, muted catchlights, adult bone structure, no beauty-filter look';

const LOOK_CLAUSE: Record<Look, string> = {
  photoreal: `photoreal, ${REALISM_CLAUSE}`,
  editorial: 'editorial photography, styled lighting, magazine finish',
  'anime-2d': '2D anime illustration',
  '3d-stylised': 'stylised 3D render',
  'game-concept': 'game character concept art',
  claymation: 'claymation stop-motion look',
};

const ARCHETYPE_REGISTER: Record<Archetype, string> = {
  'creator/host': 'a creator and on-camera host',
  expert: 'a subject-matter expert',
  'customer-demo': 'an everyday customer in a demo',
  storyteller: 'a warm storyteller',
  mascot: 'a friendly brand mascot',
  athlete: 'an athlete',
  executive: 'a composed executive',
  student: 'a student',
  parent: 'a parent',
  villain: 'a charismatic antagonist',
};

// The lowest age each range starts at, used only to reject minors defensively.
const AGE_FLOOR: Record<AgeRange, number> = {
  '18-24': 18,
  '25-34': 25,
  '35-44': 35,
  '45-54': 45,
  '55+': 55,
};

// Reject any age below eighteen, whether from the select or a free-text region
// note that names one (PRD-07 §15 acceptance 1). Throws so callers cannot ignore.
export function assertAdult(ageRange: AgeRange, freeText = ''): void {
  if (AGE_FLOOR[ageRange] < 18) {
    throw new KilnryError('INVALID_INPUT', 'Kilnry does not generate minors as characters.');
  }
  const match = /\b(\d{1,2})\s*(?:years?|yo|y\/o)?\b/gi;
  let found: RegExpExecArray | null;
  while ((found = match.exec(freeText)) !== null) {
    const age = Number(found[1]);
    if (age > 0 && age < 18) {
      throw new KilnryError('INVALID_INPUT', 'Kilnry does not generate minors as characters.');
    }
  }
}

// Build the anchor prompt from the chosen traits. The anchor never uses the
// setting hint; only the alternates may (PRD-07 §15).
export function castAnchorPrompt(params: CastParams): string {
  assertAdult(params.age_range, `${params.region ?? ''} ${params.setting_hint ?? ''}`);
  const parts = [
    `A portrait of ${ARCHETYPE_REGISTER[params.archetype]}`,
    `aged ${params.age_range}`,
    ...(params.region ? [`${params.region} heritage`] : []),
    `${params.wardrobe} wardrobe`,
    `${params.vibe} presence`,
    LOOK_CLAUSE[params.look],
    'head-and-shoulders framing, neutral background, even key light',
    ORIGINAL_PERSON_CLAUSE,
  ];
  return `${parts.join(', ')}.`;
}

// The three alternates vary the same person; the third may lean on the setting
// hint. Returned as prompt strings for a count-4 generation (anchor + three).
export function castAlternatePrompts(params: CastParams): string[] {
  const base = castAnchorPrompt(params);
  const alternates = [
    base.replace(/\.$/, ', a slightly different expression and hair.'),
    base.replace(/\.$/, ', a different outfit within the same register.'),
  ];
  alternates.push(
    params.setting_hint
      ? base.replace(/\.$/, `, on location in ${params.setting_hint}.`)
      : base.replace(/\.$/, ', a three-quarter angle.'),
  );
  return alternates;
}

/** Everything a cast generation needs: one anchor plus three alternates. */
export function castGenerationPrompts(params: CastParams): { anchor: string; alternates: string[] } {
  return { anchor: castAnchorPrompt(params), alternates: castAlternatePrompts(params) };
}

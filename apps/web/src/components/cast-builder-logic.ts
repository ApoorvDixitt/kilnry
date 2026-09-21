// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Framework-free helpers for the cast builder form (F-CHR-15), unit-tested
// without a browser. The age options never include minors; the pick grid must be
// answered before the Character is saved.

export const ARCHETYPES = [
  'creator/host',
  'expert',
  'customer-demo',
  'storyteller',
  'mascot',
  'athlete',
  'executive',
  'student',
  'parent',
  'villain',
] as const;

// Age ranges start at eighteen: minors are never an option (acceptance 1).
export const AGE_RANGES = ['18-24', '25-34', '35-44', '45-54', '55+'] as const;
export const LOOKS = [
  'photoreal',
  'editorial',
  'anime-2d',
  '3d-stylised',
  'game-concept',
  'claymation',
] as const;
export const WARDROBES = [
  'casual',
  'smart-casual',
  'traditional',
  'sportswear',
  'uniform',
  'formal',
] as const;
export const VIBES = [
  'warm and approachable',
  'deadpan',
  'energetic',
  'authoritative',
  'mysterious',
] as const;

export interface CastForm {
  archetype: (typeof ARCHETYPES)[number];
  age_range: (typeof AGE_RANGES)[number];
  look: (typeof LOOKS)[number];
  region: string;
  wardrobe: (typeof WARDROBES)[number];
  vibe: (typeof VIBES)[number];
  setting_hint: string;
}

// The form defaults (bold options in PRD-07 §15).
export function defaultCastForm(): CastForm {
  return {
    archetype: 'creator/host',
    age_range: '25-34',
    look: 'photoreal',
    region: '',
    wardrobe: 'casual',
    vibe: 'warm and approachable',
    setting_hint: '',
  };
}

// A free-text field naming an age below eighteen is rejected before generating.
export function mentionsMinor(text: string): boolean {
  const match = /\b(\d{1,2})\s*(?:years?|yo|y\/o)?\b/gi;
  let found: RegExpExecArray | null;
  while ((found = match.exec(text)) !== null) {
    const age = Number(found[1]);
    if (age > 0 && age < 18) return true;
  }
  return false;
}

// Whether Generate may be pressed: not already generating, and no minor named in
// the region or setting free text.
export function canGenerate(form: CastForm, generating: boolean): boolean {
  if (generating) return false;
  return !mentionsMinor(form.region) && !mentionsMinor(form.setting_hint);
}

// The pick grid must be answered (an anchor chosen) before the Character saves.
export function canSaveAfterPick(pickedAssetId: string | undefined): boolean {
  return Boolean(pickedAssetId && pickedAssetId.trim());
}

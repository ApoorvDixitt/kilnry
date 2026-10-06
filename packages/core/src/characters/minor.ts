// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// `minor_suspected` (PRD-07 §7, F-07): "`age:` tag or descriptor words
// indicating a minor ("child", "kid", "teen", "boy", "girl" with age < 18 in
// the descriptor) set `minor_suspected = true` → Train/Clone disabled with
// 'Kilnry does not train or clone minors.'" and "minors cannot be trained or
// cloned in Kilnry regardless of consent".

export const MINOR_REFUSAL = 'Kilnry does not train or clone minors.';

export interface MinorSignals {
  tags?: readonly string[] | null | undefined;
  descriptor?: string | null | undefined;
  anchors?: readonly string[] | null | undefined;
}

// Words that name a minor on their own. "boy" and "girl" are used of adults
// too, so they count only beside an age under eighteen, which counts anywhere
// in the descriptor in any case. (default; adjustable)
const MINOR_WORDS = /\b(?:child|children|kid|kids|teen|teens|teenager|teenagers|teenage)\b/i;
const AGE_PATTERNS = [
  // "15 year old", "15-year-old", "15 yrs old" — a bare "5 years" is
  // experience, not age, so "old" is required here.
  /\b(\d{1,2})\s*-?\s*(?:years?|yrs?)\s*-?\s*old\b/gi,
  // "15yo", "15 y/o"
  /\b(\d{1,2})\s*(?:yo|y\/o)\b/gi,
  // "aged 15", "age 15", "age: 15"
  /\bage(?:d)?\s*:?\s*(\d{1,2})\b/gi,
];

function ageBelowEighteen(text: string): boolean {
  for (const pattern of AGE_PATTERNS) {
    pattern.lastIndex = 0;
    let found: RegExpExecArray | null;
    while ((found = pattern.exec(text)) !== null) {
      const age = Number(found[1]);
      if (age < 18) return true;
    }
  }
  return false;
}

function ageTagBelowEighteen(tags: readonly string[]): boolean {
  for (const tag of tags) {
    const match = tag.trim().match(/^age\s*:\s*(.+)$/i);
    if (!match) continue;
    const value = match[1]!.trim();
    const numeric = value.match(/^(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?\+?$/);
    if (numeric) {
      // "age:15" or a range "age:16-19" whose lower end is under eighteen.
      if (Number(numeric[1]) < 18) return true;
      continue;
    }
    if (MINOR_WORDS.test(value) || /\b(?:minor|baby|toddler|infant)\b/i.test(value)) return true;
  }
  return false;
}

/** True when the Character's tags or descriptor read as a minor. */
export function minorSuspected(signals: MinorSignals): boolean {
  if (ageTagBelowEighteen(signals.tags ?? [])) return true;
  const text = [signals.descriptor ?? '', ...(signals.anchors ?? [])].join(' \n ');
  if (text.trim() === '') return false;
  if (ageBelowEighteen(text)) return true;
  return MINOR_WORDS.test(text);
}

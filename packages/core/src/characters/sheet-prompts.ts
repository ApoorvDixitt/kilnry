// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Kilnry's own prompt templates for the reference-sheet pipeline (F-CHR-04,
// PRD-07 §5.4–5.6). The "Build sheet" button and the character-sheet workflow
// use the same wording so an anchor edited into turnaround rows, a full-body
// shot, and an expression grid come out consistent. Each template takes the
// short appearance summary and produces a single sheet image that is later cut
// into separate reference files.

// T0 — clean the anchor from a source photo: neutral pose, plain background.
export const T0_ANCHOR = [
  'Clean, well-lit character reference of the person in image 1.',
  'Waist-up, facing the camera, neutral expression, arms relaxed.',
  'Plain light-grey studio background, even soft lighting, no props.',
  'Keep the face, hair, and build exactly as in image 1.',
].join(' ');

// T0_TEXT — generate an anchor from a text description (no source photo).
export const T0_ANCHOR_TEXT = [
  'Clean, well-lit character reference, waist-up, facing the camera, neutral expression.',
  'Plain light-grey studio background, even soft lighting, no props.',
  '{{short}}',
].join(' ');

// T1 — turnaround row sheet A: four panels in one row.
export const T1_SHEET_A = [
  'A single wide image: four equal panels in one row showing the same person from image 1.',
  'Panels left to right: front view, three-quarter left, left profile, back view.',
  'Consistent identity, outfit, lighting, and scale across all four panels.',
  'Plain light-grey background, full turnaround pose, no text or labels. {{short}}',
].join(' ');

// T2 — turnaround row sheet B: two panels in one row.
export const T2_SHEET_B = [
  'A single wide image: two equal panels in one row showing the same person from image 1.',
  'Panels left to right: three-quarter right, right profile.',
  'Consistent identity, outfit, lighting, and scale across both panels.',
  'Plain light-grey background, no text or labels. {{short}}',
].join(' ');

// T3 — the 3×3 expression grid.
export const T3_EXPRESSIONS = [
  'A single image: a three by three grid of the same person from image 1, head and shoulders.',
  'Expressions, row-major: neutral, gentle smile, laughing, surprised, angry, sad, thoughtful, determined, shouting.',
  'Consistent identity, hair, and lighting across all nine cells, plain background, no text. {{short}}',
].join(' ');

// Render a template by substituting the short appearance summary.
export function renderSheetPrompt(template: string, short: string): string {
  return template.replaceAll('{{short}}', short).trim();
}

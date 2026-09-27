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

// ── The workflow-facing templates (kilnry-character-sheet.yaml) ───────────────
// The character-sheet workflow renders these through the template engine's
// render() function, so their placeholders are the {{token}} names that
// workflow passes: {{n}}, {{views}}, {{outfit}}, {{look}}, {{exprs}},
// {{anchors}}, {{state_description}}. They are kept as plain string exports so
// the workflow's file('...#EXPORT') reference reads them without executing code.
// The "Build sheet" button above uses its own {{short}} variants; the two paths
// share wording but not tokens.

// T0 — clean the anchor from a source photo.
export const T0 = [
  'Clean, well-lit character reference of the person in image 1.',
  'Waist-up, facing the camera, neutral expression, arms relaxed.',
  'Plain light-grey studio background, even soft lighting, no props.',
  'Keep the face, hair, and build exactly as in image 1. {{look}} look.',
].join(' ');

// T0_TEXT — generate the anchor from a text description (no source photo).
export const T0_TEXT = [
  'Clean, well-lit character reference, waist-up, facing the camera, neutral expression.',
  'Plain light-grey studio background, even soft lighting, no props. {{look}} look.',
].join(' ');

// T1 — a turnaround row of {{n}} panels showing the named {{views}}.
export const T1 = [
  'A single wide image: {{n}} equal panels in one row showing the same person from image 1.',
  'Panels left to right: {{views}}.',
  'Consistent identity, outfit, lighting, and scale across all panels.',
  'Wearing {{outfit}}. Plain light-grey background, full turnaround pose, no text or labels. {{look}} look.',
].join(' ');

// T1_FULL — a single full-body shot.
export const T1_FULL = [
  'A single full-body image of the same person from image 1, standing, facing the camera.',
  'Head to feet in frame, natural stance, wearing {{outfit}}.',
  'Plain light-grey background, even lighting, no text or labels. {{look}} look.',
].join(' ');

// T2 — the expression grid over the named {{exprs}}, anchored on {{anchors}}.
export const T2 = [
  'A single image: a three by three grid of the same person from image 1, head and shoulders.',
  'Expressions, row-major: {{exprs}}.',
  'Keep these features constant across every cell: {{anchors}}.',
  'Consistent hair and lighting, plain background, no text. {{look}} look.',
].join(' ');

// T3_IMAGE — an outfit change driven by a reference garment image.
export const T3_IMAGE = [
  'The same person from image 1, waist-up, facing the camera, neutral expression.',
  'Dress them in the garment shown in image 2, fitted naturally to their body.',
  'Plain light-grey background, even lighting, no text or labels.',
].join(' ');

// T3_TEXT — an outfit change described in words.
export const T3_TEXT = [
  'The same person from image 1, waist-up, facing the camera, neutral expression.',
  'Dress them in {{outfit}}, fitted naturally to their body.',
  'Plain light-grey background, even lighting, no text or labels.',
].join(' ');

// T3_STATE — the same person in a described state or scene.
export const T3_STATE = [
  'The same person from image 1, {{state_description}}.',
  'Keep the face, hair, and build exactly as in image 1.',
  'Even lighting, no text or labels.',
].join(' ');

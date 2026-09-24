---
# Kilnry — https://github.com/ApoorvDixitt/kilnry
# Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
# SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
# See LICENSE.md in the repository root. You may not remove or obscure this notice.
name: kilnry-character-sheet
description: "Build or extend a Character's reference sheet from one anchor image: turnaround views, expression cells, outfit and state variants as separate files, and refresh the appearance descriptor. Use when the user asks for a character sheet, model sheet, turnaround, expression sheet, reference sheet, or wants a Character to stay consistent across generations. Not for creating a new person from nothing (use the cast builder) and not for training identities."
license: CC-BY-4.0
compatibility: Kilnry 1.x with an image-edit provider that accepts at least one reference image (GPT Image 2.5, Nano Banana Pro, Seedream 4.5, Qwen edit).
metadata:
  kilnry:
    version: 1.0.0
    pipeline: kilnry-character-sheet
    requires: [image_edit, vlm]
    cost_hint_usd: [0.2, 1.2]
    triggers: [character sheet, turnaround, expression sheet, reference sheet, keep her consistent, model sheet]
    workflows: [workflows/character-sheet.yaml]
---

# Character Sheet

A sheet is a set of separate reference files that let every model see the same person from the angles it needs. Grids and rows are only intermediate; Kilnry splits them into single-view files and never sends a multi-face image to a video model.

## Decide who

- If the user names `@handle`, call `kilnry_characters get` and read what exists: anchor, which of the seven views (front, three-quarter left and right, profile left and right, back, full body), expression cells (nine), outfits, states, look tag, consent.
- If there is no Character yet, stop: offer to create one from a photo or the cast builder (`kilnry_characters_manage create`). Do not build a sheet from a description alone.
- If `is_real_person` is true and consent is not recorded, you may still build reference sheets; training and export stay disabled and you should say so once.

## Decide what

Default: every missing view, the expression set, and any outfits or states the user mentioned. Ask one question only when the look is ambiguous (photoreal vs anime vs 3D) and no `look:` tag exists.

## Price and run

Call `kilnry_characters_manage build_sheet` with `sheet: {views, expressions, outfits, model}`; it returns the plan through the workflow. Default model is GPT Image 2.5 (sharpest multi-view); offer Seedream 4.5 when the user wants cheap (about a fifth of the price). Read the total in one line and wait for approval in Ask-first.

## Quality bar (check at the soft approval)

1. Same face, hair, skin tone and outfit in every view; mid-grey backdrop; even light; waist-up framing for turnaround panels, head-and-shoulders for expression cells, head-to-toe for full body.
2. Panel count and order match the request; the splitter verifies and regenerates once, then falls back to one call per view with a new price.
3. Expression cells differ only in expression.
4. Outfit variants keep face, hair, pose, camera and background; the garment is an appearance reference only.
5. Non-photoreal looks use their own render clauses and never mix looks in one sheet.

If a view is wrong, regenerate that view only. Never regenerate the anchor mid-run; changing the anchor is a new Character version.

## After the run

Report: which files were added (as a short list of view names, not paths, unless asked), the refreshed descriptor's first sentence and anchors, and the version (a frozen version forks to v+1). Offer one next step: train an identity (show price and consent gate) or try the Character in a scene.

## Files

- `workflows/character-sheet.yaml`
- `references/templates.md`: Kilnry's T0–T3 prompt templates and look clause map.

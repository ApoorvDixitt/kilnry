---
# Kilnry — https://github.com/ApoorvDixitt/kilnry
# Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
# SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
# See LICENSE.md in the repository root. You may not remove or obscure this notice.
name: kilnry-video-edit
description: "Edit existing footage with Kilnry's local operations: trims, cuts, concat, speed, fades, overlays, title cards, aspect padding, audio normalise and mux, GIF and sprite exports. Free and offline. Use when the user has clips and wants an edit, not a generation."
license: CC-BY-4.0
metadata:
  kilnry:
    version: 1.0.0
    requires: []
    cost_hint_usd: [0, 0]
    triggers: [trim, cut these, stitch, add a title card, make a gif]
---

# Video Edit

You edit footage the user already has, using Kilnry's local media operations. Nothing here spends: every operation runs on the machine, so there is no estimate and no confirmation to gather — only the edit to describe.

## Intake

- **clips**: the files to edit. Required.
- **what to do**: trim, cut, stitch (concat), change speed, add fades, overlay an image or text, add a title card, pad to an aspect, normalise or replace audio, or export a GIF or sprite sheet.

## Guidance

Map the request to the named local operations in order; keep the source untouched and write a new output. Prefer a copy (no re-encode) when the inputs already match, and re-encode only when an operation needs it. Normalise audio to a broadcast target when the user asks for consistent loudness. Report the output path and that it was free and offline.

## Deliver

The edited file path, one line, noting it was produced locally at no cost.

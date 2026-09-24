---
# Kilnry — https://github.com/ApoorvDixitt/kilnry
# Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
# SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
# See LICENSE.md in the repository root. You may not remove or obscure this notice.
name: kilnry-brand-kit
description: "Build a brand's visual system from facts and existing assets: palette, typography pairing, logo directions, social templates, mockups and packaging renders; recolour and export existing logos deterministically. Use for branding, brand kits, logo directions, mockups, applying a logo to assets. Not for ads or product photography."
license: CC-BY-4.0
metadata:
  kilnry:
    version: 1.0.0
    requires: [text2image]
    cost_hint_usd: [0.2, 3]
    triggers: [brand kit, logo, brandbook, mockups]
---

# Brand Kit

You assemble a brand's visual system from the facts the user gives and the assets they already have. There is no single workflow; you compose presets and the local image operations, and you keep deterministic steps — recolouring and exporting an existing logo — out of the model's hands.

## Intake

- **brand facts**: name, what it does, tone, any existing colours or fonts.
- **existing assets**: a logo, past imagery, a website URL.
- **what to produce**: palette, type pairing, logo directions, social templates, mockups, packaging.

## Guidance

Derive the palette and typography from the facts and assets before generating anything. Generate logo directions and mockups through the appropriate presets. Recolour and lay out an existing logo with the local image operations so the exact mark is preserved rather than redrawn. Keep the brand colours consistent across every produced asset, and record them in project memory so later skills stay on brand.

## Deliver

The folder of assets grouped by kind, and the cost, one line. Offer one next step: apply the kit to a product photoshoot or a thumbnail set.

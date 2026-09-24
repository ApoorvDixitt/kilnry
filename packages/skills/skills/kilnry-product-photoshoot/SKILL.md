---
# Kilnry — https://github.com/ApoorvDixitt/kilnry
# Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
# SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
# See LICENSE.md in the repository root. You may not remove or obscure this notice.
name: kilnry-product-photoshoot
description: "Create polished product stills: packshots, lifestyle scenes, product with hands, hero banners, carousels, static ad packs, virtual try-on, conceptual shots, restyles, keeping one product identity across the set. Use for product photos, catalogue or store imagery, campaign stills, banner backgrounds. Not for video, thumbnails, or UGC."
license: CC-BY-4.0
metadata:
  kilnry:
    version: 1.0.0
    pipeline: kilnry-product-photoshoot
    requires: [image_edit, vlm, bg_remove]
    cost_hint_usd: [0.15, 2]
    triggers: [product photos, packshot, lifestyle shots, banner, carousel, try-on stills]
    workflows: [workflows/product-photoshoot.yaml]
---

# Product Photoshoot

You produce a set of product stills that keep one product identity — its geometry, colour and label — while the scene, light and framing change. The pipeline is the `kilnry-product-photoshoot` Workflow; you gather the product and the mode, run the plan, and steer the checkpoints.

## Intake

Read the message and `project.md`. Lock what is stated; ask only for real gaps in one message:

- **product**: an Element, an image, or a product URL. Required.
- **mode**: packshot · lifestyle · with a person · hero banner · carousel · ad pack · try-on · conceptual · restyle. Infer from words like "on a table", "held", "banner", "cut-out".
- **variants**: how many, 1 to 6. Default three.
- **aspect**, **background** (clean studio, surface, scene, transparent), **brand colours**, and a `@character` when the mode places a person.

Never ask about models or resolution.

## Run and steer

`kilnry_workflows plan`, read the total in one line, then run. The workflow reads the product first, generates each variant, and runs a refine pass that keeps the product geometry and label and fixes only light and edges. A transparent background triggers a background-removal transform.

## Quality bar

The product's shape, colour and label are unchanged in every shot; no duplicate products; no invented text on the packaging; the person, when present, is natural and secondary. Regenerate a single variant if it drifts; never let a refine pass reshape the product.

## Deliver

The folder, how many stills, the mode, and the actual cost, in one line. Offer one next step: a transparent cut-out set, or the same product in another mode.

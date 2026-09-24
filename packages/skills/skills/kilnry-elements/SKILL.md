---
# Kilnry — https://github.com/ApoorvDixitt/kilnry
# Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
# SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
# See LICENSE.md in the repository root. You may not remove or obscure this notice.
name: kilnry-elements
description: "Create and maintain Elements: props from product URLs or photos (title, images, ticked claims, price, brand colours), environments, styles, and state variants; write the appearance-only injection wording. Use when a product, location or style will recur across generations or before an ad workflow needs a product."
license: CC-BY-4.0
metadata:
  kilnry:
    version: 1.0.0
    requires: [vlm]
    cost_hint_usd: [0, 0.1]
    triggers: [save this product, make an element, from this url]
---

# Elements

You create and maintain Elements — the reusable props, environments and styles that recur across generations. This is where an ad's product should exist before the UGC or product workflow needs it.

## Intake

- **source**: a product URL, a photo, or a description.
- **kind**: prop, environment or style.
- for a product prop: the **title**, the **images**, the **approved claims** to tick, the **price** and the **brand colours**.

## Guidance

From a URL or photo, read the product with the vision-language route and draft the title, a short factual description, the visible claims (ticked only when the user confirms each), the price and the brand colours. Write the appearance-only injection wording so the Element describes how the thing looks, never a claim about it. Group state variants (dry and wet, on and off) under one Element. Keep the source untouched and store the Element for later `@mention`.

## Deliver

The Element handle, its kind, and what was captured, one line. Offer one next step: use it in a product photoshoot or an ad.

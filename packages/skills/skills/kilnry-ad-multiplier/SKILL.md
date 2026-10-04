---
# Kilnry — https://github.com/ApoorvDixitt/kilnry
# Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
# SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
# See LICENSE.md in the repository root. You may not remove or obscure this notice.
name: kilnry-ad-multiplier
description: "Turn one short ad (4–30 s) into several separately edited variants with different people, wardrobe, locations, or props, keeping the original motion, cut points, timing, captions and audio. Use when the user asks to multiply or vary an existing ad. Runs the kilnry-ad-multiplier workflow; requires a video-edit provider."
license: CC-BY-4.0
metadata:
  kilnry:
    version: 1.0.0
    requires: [video2video, vlm, stt]
    cost_hint_usd: [2, 20]
    triggers: [multiply my ad, variations of this ad]
    workflows: [workflows/ad-multiplier.yaml]
---

# Ad Multiplier

You take one finished short ad and produce several variants that keep the original motion, cut points, timing, captions and audio while changing the person, wardrobe, location or props. The kilnry-ad-multiplier workflow renders each variant as its own edit (one generate call per output, never batched), so the output duration equals the source. Replacement people are Characters with recorded consent or generated adults.

## Intake

- **source ad**: the finished clip. Required.
- **what varies**: person, wardrobe, location, props — one axis or several.
- **count**: how many variants.

## Guidance

Keep the cut points and timing identical across variants so a set can run on the same schedule; vary only the chosen axis; carry the original captions and audio unless the person changes and re-voicing is needed. When a video-edit provider is connected (Genjutsu is the premium opt-in, flux-video-edit the draft tier), the workflow renders each variant as a separate edit; without one, describe the plan and the cost range and offer to prepare the source and the variant briefs.

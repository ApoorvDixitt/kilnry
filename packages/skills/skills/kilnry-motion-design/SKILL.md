---
# Kilnry — https://github.com/ApoorvDixitt/kilnry
# Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
# SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
# See LICENSE.md in the repository root. You may not remove or obscure this notice.
name: kilnry-motion-design
description: "Write and render motion-design and explainer films (15–60 s) as short animated blocks in a named style, with a locked style key, timestamped beats and one camera move per block, optional voiceover and music, assembled locally. Use for launch videos, product films, brand motion, animated explainers in a named style. Not for talking heads or narrated channel videos."
license: CC-BY-4.0
metadata:
  kilnry:
    version: 1.0.0
    pipeline: kilnry-motion-design
    requires: [text2image, text2video, tts, stt]
    cost_hint_usd: [1, 10]
    triggers: [launch video, motion design, product film, animated explainer]
    workflows: [workflows/motion-design.yaml]
---

# Motion Design and Explainer

You write and render a short explainer or launch film in a chosen motion-design style. The pipeline is the `kilnry-motion-design` Workflow: a script of scenes, a locked style key, one animated clip per scene with a single camera move, voiceover, an optional logo end card, and burned subtitles.

## Intake

- **brief**: what the film explains or launches. Required.
- **style**: SaaS motion, Apple-clean, paper collage, 2D vector, claymation or blueprint.
- **duration** (15–60 s), **aspect**, **voice** (required), **brand colours**, and an optional **logo** for the end card.

## Run and steer

Write the scenes (one spoken line and one visual per scene), lock a style key at the soft checkpoint, then render each scene as one clip in that exact style with a single camera move, mux its voice, assemble, add the logo end card, and burn subtitles. Regenerate a scene rather than switching the style mid-film.

## Deliver

The final path, duration, aspect and cost, one line. Offer one next step: a second cut in the same style, or a captioned social crop.

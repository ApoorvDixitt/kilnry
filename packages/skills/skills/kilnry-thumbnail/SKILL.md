---
# Kilnry — https://github.com/ApoorvDixitt/kilnry
# Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
# SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
# See LICENSE.md in the repository root. You may not remove or obscure this notice.
name: kilnry-thumbnail
description: "Design and render YouTube, Instagram or video cover thumbnails: concept from proven frameworks, identity-locked faces from Characters, high-resolution render, surgical tweaks, deterministic local text overlay. Use for thumbnails, video covers, previews, big bold packaging for a video. Not for posters or product stills."
license: CC-BY-4.0
metadata:
  kilnry:
    version: 1.0.0
    pipeline: kilnry-thumbnail
    requires: [image_edit, vlm]
    cost_hint_usd: [0.3, 4]
    triggers: [thumbnail, video cover, youtube cover]
    workflows: [workflows/thumbnail.yaml]
---

# Thumbnail

You design a high-contrast cover that reads at a glance. The pipeline is the `kilnry-thumbnail` Workflow; you settle the topic, the framing and the headline, then let the text land as a deterministic local overlay rather than a generated caption.

## Intake

- **topic**: what the video is about. Required.
- **face references**: up to three, or a `@character`, when a person is the focal point.
- **headline**: at most six words; it is burned locally so it stays crisp and correct.
- **aspect**: 16:9, 9:16 or 1:1. **emotion**: the expression the subject wears. **takes**: how many scene renders to choose from.

## Run and steer

Propose three framings and let the user pick one at the soft checkpoint. Cast the subject with the chosen emotion when face references exist, compose the scene leaving the title third clear, then overlay the headline with the local text op — never a model-generated caption. Regenerate a take rather than editing baked-in text.

## Deliver

The thumbnail path, aspect, and cost, one line. Offer one next step: a second headline, or a variant in another emotion.

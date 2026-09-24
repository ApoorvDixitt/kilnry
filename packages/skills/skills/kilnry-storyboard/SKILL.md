---
# Kilnry — https://github.com/ApoorvDixitt/kilnry
# Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
# SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
# See LICENSE.md in the repository root. You may not remove or obscure this notice.
name: kilnry-storyboard
description: "Turn a scene idea into a shot plan and storyboard stills (3–8 frames) with Characters and Elements, ready to approve and optionally animate shot by shot. Use for storyboards, shot lists, previsualisation, or planning the shots first. Not for finished ads."
license: CC-BY-4.0
metadata:
  kilnry:
    version: 1.0.0
    pipeline: kilnry-storyboard
    requires: [image_edit]
    cost_hint_usd: [0.2, 1.5]
    triggers: [storyboard, shot list, plan the shots]
---

# Storyboard

You turn a scene idea into a shot plan and a small set of storyboard stills the user can approve before any expensive animation. This is the plan-first step, not a finished deliverable.

## Intake

- **scene idea**: what happens. Required.
- **frames**: how many, 3 to 8.
- **cast**: any Characters and Elements that recur across the frames.

## Guidance

Write a shot list first — one line per frame naming shot size, angle and action — then render each frame as a still using the named Characters and Elements so the people and props stay consistent. Keep the frames cheap and quick; they exist to be judged, not shipped. Present the shot list and the stills together for approval, and offer to animate shot by shot once approved.

## Deliver

The shot list and the frame stills, and the cost, one line. Offer one next step: animate the approved shots, or hand the plan to a video workflow.

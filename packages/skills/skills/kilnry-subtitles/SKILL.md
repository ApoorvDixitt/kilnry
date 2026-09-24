---
# Kilnry — https://github.com/ApoorvDixitt/kilnry
# Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
# SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
# See LICENSE.md in the repository root. You may not remove or obscure this notice.
name: kilnry-subtitles
description: "Burn word-timed captions into a finished video in one of three looks, with timing from local or provider transcription and a transcript check. Use when the deliverable is a captioned video or another skill needs captions. Not for translation or dubbing."
license: CC-BY-4.0
metadata:
  kilnry:
    version: 1.0.0
    pipeline: kilnry-subtitles-burn
    requires: []
    cost_hint_usd: [0, 0.05]
    triggers: [subtitles, captions, burn captions]
    workflows: [workflows/subtitles-burn.yaml]
---

# Subtitles

You add readable, word-timed captions to a finished video. The pipeline is the `kilnry-subtitles-burn` Workflow; transcription runs locally when the transcriber is installed, otherwise through a speech provider, and the words are reviewed before they are burned.

## Intake

- **video**: the file to caption. Required.
- **look**: clean, paper or bold. **language**, **max line characters**, **position** (lower third, centre, top), and whether to use a karaoke word-by-word reveal.

## Run and steer

Transcribe, then pause at the soft transcript checkpoint so a mishearing can be corrected before it is baked in. Burn the captions with the chosen look and position. This is free when the local transcriber is used.

## Deliver

The captioned video path and cost, one line. This skill only captions; for another language, hand off to Localize.

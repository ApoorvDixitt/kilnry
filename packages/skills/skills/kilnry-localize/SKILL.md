---
# Kilnry — https://github.com/ApoorvDixitt/kilnry
# Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
# SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
# See LICENSE.md in the repository root. You may not remove or obscure this notice.
name: kilnry-localize
description: "Dub a video into another language with a chosen or matched voice, fit translated lines per segment without time-stretching, preserve music where possible, and re-sync lips. Use for dubbing, translation with voice, localisation. Not for subtitles only."
license: CC-BY-4.0
metadata:
  kilnry:
    version: 1.0.0
    pipeline: kilnry-localize
    requires: [stt, tts, lipsync]
    cost_hint_usd: [0.5, 5]
    triggers: [dub, translate this video, localize, hindi version]
    workflows: [workflows/localize.yaml]
---

# Localize

You dub a video into up to three languages. The pipeline is the `kilnry-localize` Workflow: transcribe, translate with timing hints, review, then either a provider dub or a per-segment voice, optional lip-sync, and optional burned subtitles — one output per language.

## Intake

- **video**: the source. Required.
- **target languages**: up to three. Required.
- **keep voice** (clone the original), **provider dub** (use a dubbing provider) or a chosen **voice**; **lip-sync** and **burn subtitles** toggles.

Cloning the original voice requires the recorded consent of its owner; a supplied video is not consent.

## Run and steer

Translate each language preserving segment timing, pause at the review checkpoint, then dub: a provider dub, or a per-segment voice fitted without time-stretching. Mux the new track, keeping the music stem where it can be separated, lip-sync when asked, and burn subtitles when asked.

## Deliver

One output path per language and the total cost, one line. For captions only, use Subtitles instead.

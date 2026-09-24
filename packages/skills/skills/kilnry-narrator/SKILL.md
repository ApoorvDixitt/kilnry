---
# Kilnry — https://github.com/ApoorvDixitt/kilnry
# Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
# SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
# See LICENSE.md in the repository root. You may not remove or obscure this notice.
name: kilnry-narrator
description: "Generate narration that fits: numbered takes fitted to fixed windows, a continuous locked-voice read, or an on-screen presenter composited from a consenting Character over an existing video. Use for voiceover lines, narration for blocks, or putting a presenter in a video. Never time-stretches audio."
license: CC-BY-4.0
metadata:
  kilnry:
    version: 1.0.0
    pipeline: kilnry-narrator
    requires: [tts, stt]
    cost_hint_usd: [0.05, 3]
    triggers: [voiceover, narration, read this, presenter]
    workflows: [workflows/narrator.yaml]
---

# Narrator

You turn written lines into spoken narration with one voice. The pipeline is the `kilnry-narrator` Workflow. A line that runs longer than its window is shortened by rewriting, never by stretching the audio.

## Intake

- **mode**: takes (numbered, each fitted to a window), continuous (one locked-voice read), or presenter (an on-screen Character reading over a video).
- **lines**: one spoken line per entry.
- **voice**: a `provider:voice_id` or a `@character` with a bound voice. Required. For presenter mode, the Character's consent must be recorded.

## Run and steer

Each take is generated, then measured. A take that overruns its window is rewritten to fit and regenerated; the audio itself is never time-stretched. Continuous mode joins the takes with the chosen gap. Presenter mode composites the consenting Character over the supplied video.

## Deliver

The take files or the joined track, and the cost, one line. Report the measured durations so the caller can place them.

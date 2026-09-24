---
# Kilnry — https://github.com/ApoorvDixitt/kilnry
# Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
# SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
# See LICENSE.md in the repository root. You may not remove or obscure this notice.
name: kilnry-faceless-video
description: "Produce a finished narrator-led channel video (1–5 minutes) in a locked non-photoreal look with one voice, an optional music bed, burned subtitles, and a thumbnail. Five storytelling styles: explainer, history, kids, picture story, myth. Two motion modes: animated 10-second blocks or narrated stills. Use for faceless YouTube videos, narrated explainers or stories, documentary-style shorts, storybook or myth retellings, kids videos. Not for talking heads, UGC, ads, a single clip, image-to-video, or editing existing footage."
license: CC-BY-4.0
compatibility: Kilnry 1.x with a text-to-image provider, an image-to-video provider (MiniMax H3 preferred), and a speech provider. Subtitles use the local transcriber when installed.
metadata:
  kilnry:
    version: 1.0.0
    pipeline: kilnry-faceless-video
    requires: [text2image, image2video, tts]
    cost_hint_usd: [2, 20]
    triggers: [faceless, narrated explainer, history video, kids story video, storybook, myth retelling, documentary short]
    workflows: [workflows/faceless-video.yaml]
---

# Faceless Narrated Video

One finished file: narrator voice, locked look, consistent cast and locations, hard-cut motion blocks or held stills, optional subtitles and thumbnail. The Workflow does the mechanics; you run the intake, the checkpoints, and the delivery.

## Intake, in this order, asking only what is missing

1. **Style**: explainer (recommended for most topics), history, kids, picture story, myth. Words like "fairy tale", "legend", "folklore" lock myth; "storybook", "one picture per line" lock picture story.
2. **Motion mode**: animated (moving shots) or stills (one picture per spoken line). Picture story is always stills.
3. **Look**: offer the style's default (explainer and history: editorial motion; kids: studio 3D; myth: painted storybook; stills: pastel flat 2D) and two alternates by name; a `@style` Element or up to three uploaded style images override everything.
4. **Duration, aspect, subtitles, thumbnail**: one combined question, one parameter per line; 16:9 default; subtitles off by default; thumbnail on.
5. **Topic or script**: an idea in a sentence, or a pasted script (verbatim; never rewritten; block count from word count, about 22 words per 10-second block; if that conflicts with a stated duration, say the number and ask which wins).
6. **Voice**: the project's default voice or a `@voice`; if none exists, show `kilnry_voices list` for the language and let the user pick; never pick for them silently; an empty answer takes the workspace default and you say so.

State every locked value with its source once, in one line ("Style: explainer (you) · Animated (default) · Look: editorial motion (default) · 60 s (you) · 16:9 (default) · Subtitles off (default) · Thumbnail on (default) · Voice: @riya (project)"). No generation before this line exists.

## Plan and price

`kilnry_workflows plan`. Blocks = duration / 10, minimum 3. Read the total; offer 2K only if asked (about twice the block cost). Run.

## Checkpoints (soft: post and continue unless the user replies)

- **Style key**: does it read as the chosen look? If not, regenerate once with the look's reference images, never by switching look.
- **Script**: one line per block, 20–23 words, hook in line one, sources for explainer and history topics, no brand or IP names, kids scripts open with a question.
- **Assets**: locations, characters, props match the style key; characters have clear silhouettes; no text on assets.

## What the workflow enforces (so you can explain it)

- Every animated block is one 10-second clip of four or five hard cuts; the cut counter regenerates under-delivering blocks once, then degrades one cut.
- Narration lines are fitted by rewriting, never by stretching audio; the video is never shortened to fit speech.
- Characters gesture and emote; they never speak on screen. The narrator is external.
- One voice, locked before the first audio call.
- Captions come only from the Subtitles workflow with transcript timing.
- Exactly one output file.

## Deliver

Path, duration, aspect, whether subtitles and thumbnail were made, actual cost, one line. Offer one next step: a second episode in the same look (the style key and voice are saved in the run manifest and can be reused), or the thumbnail headline.

## Files

- `workflows/faceless-video.yaml`
- `references/looks/*.md`: Kilnry's ten look formulas with bundled reference images.
- `references/script-shapes.md`: hooks, block grammar, kids question-first skeleton, myth cadence.

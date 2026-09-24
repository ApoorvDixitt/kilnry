---
# Kilnry — https://github.com/ApoorvDixitt/kilnry
# Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
# SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
# See LICENSE.md in the repository root. You may not remove or obscure this notice.
name: kilnry-prompting
description: "Write strong prompts for one-off generations per model (Seedance, Kling, Veo, MiniMax H3, Wan, Nano Banana, GPT Image, Seedream, FLUX.2, Soul 2, ElevenLabs) with per-model guides, the Kilnry routing table, and mention rules. Use for single images, clips, or voice lines and for improving a prompt. Not for multi-step productions."
license: CC-BY-4.0
metadata:
  kilnry:
    version: 1.0.0
    requires: []
    cost_hint_usd: [0, 0]
    triggers: [write a prompt, better prompt, one image, one clip]
---

# Prompting

You write a strong prompt for a single generation, or improve one the user brought. This is guidance, not a pipeline: it costs nothing until the user runs the prompt.

## How to help

- Identify the model the request will route to (or the one the user named) and follow its guide: the shot grammar for video models, the reference and edit rules for image models, the delivery notes for voice models.
- Keep to the Kilnry routing table: name the capability, let the router pick the cheapest model that meets the constraints, and only pin a model when the user insists.
- Expand a bare idea into a prompt with subject, setting, light, framing and any negative directions; keep it concise and free of provider tokens.
- Use `@mention` rules for a Character, Element or voice so the resolver expands the likeness; never write raw internal tokens.

## Deliver

The finished prompt, the model or capability it targets, and one sentence on why. Offer to run it as a single generation.

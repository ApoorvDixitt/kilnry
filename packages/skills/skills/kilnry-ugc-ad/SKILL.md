---
# Kilnry — https://github.com/ApoorvDixitt/kilnry
# Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
# SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
# See LICENSE.md in the repository root. You may not remove or obscure this notice.
name: kilnry-ugc-ad
description: "Make a finished 9:16 UGC-style product ad (10–60 s) with one consistent creator in one of six modes: talking-head review, product-only with voiceover, unboxing reveal, wearable try-on, step-by-step tutorial, or website walkthrough with real screenshots. Use when the user asks for a UGC ad, creator video, TikTok-style review, product demo video, unboxing, try-on, tutorial video, or an ad from a product URL. Not for thumbnails, stills, narrated explainers, or edits of existing footage."
license: CC-BY-4.0
compatibility: Kilnry 1.x with an image-edit provider and a reference-to-video provider (fal or OpenRouter). Website mode needs the bundled local browser.
metadata:
  kilnry:
    version: 1.0.0
    pipeline: kilnry-ugc-ad
    requires: [image_edit, reference2video, vlm]
    cost_hint_usd: [3, 12]
    triggers: [ugc, creator video, review video, unboxing, try-on, tutorial video, ad from this link]
    workflows: [workflows/ugc-ad.yaml]
---

# UGC Ad

You are producing one vertical video file with one creator identity from first frame to last. The pipeline is a Kilnry Workflow (`kilnry-ugc-ad`); your job is to gather the inputs, pass the gates, steer the checkpoints, and deliver plainly.

## Before anything: the gates

Stop and explain, do not route around, if any of these fail.

1. **Creator authorisation.** The creator is either a Kilnry Character with consent recorded (this is me, or written permission) or a generated original adult (21+). A supplied photo is not permission. Refuse requests that involve a public figure, a celebrity, a minor, or an attempt to pass someone off as somebody else. Voices of supplied people are never cloned or imitated without recorded consent.
2. **Allowed promotion.** Decline adult content, gambling, drugs and prescription medicine, tobacco and nicotine, weapons, counterfeit or illicit goods, extremist material, deceptive finance, malware, covert surveillance, political persuasion.
3. **Truthful claims.** Only the product Element's ticked approved claims may be spoken or shown, word for word. Never strengthen, combine, or infer. With no ticked claims, write claim-free copy about visible materials, controls, use, and packaging.
4. **No synthetic testimonials.** A generated creator hosts or demonstrates; they never claim to own, have used, or seen results. First-person experience appears only in `verbatim` script mode, where the user provides the wording and ticks the box confirming it describes their own experience.
5. **Transparent framing.** Describe the output as a brand demo or creator concept, never an organic review. Include an ad disclosure in any post package.

## Intake (ask only for real gaps, one message)

Read the user's message and `project.md` first. Lock what is stated; ask only what is missing, bundled into one question:

- **mode**: review · product-only · unboxing · try-on · tutorial · website (infer from words like "unboxing", "wearing", "step by step", "my site").
- **duration**: offer 10, 15, 30, 45 s if absent.
- **creator**: `@character` (check consent) or generate (ask gender/age hints only if the brief implies them) or none (product-only).
- **product**: Element, image, or URL; never demand a product for review mode.
- **website mode**: the URL.
- **tutorial mode**: steps (3–7) or usage notes.

Never ask about models, boards, resolution, aspect, or batching. Classify specificity: a few words means you choose the treatment; a paragraph means you preserve the direction; a shot list means you map beats one-to-one.

## Plan and price

Call `kilnry_workflows plan` with the inputs. Read the plan back to the user in three lines: what will be made, the checkpoints, the total. Offer the 480p route when the 720p total exceeds $6. Then `kilnry_workflows run` with the `plan_id` (Ask-first: wait for approval; Run-automatically: proceed).

## Steering the run

- **Script checkpoint (soft):** show the monologue split by board; confirm claims are verbatim; check the product is greeted once, in board 1.
- **Boards checkpoint (hard by default):** inspect the cleaned boards: one product, one creator, slot count as planned, no baked text, no duplicate hands. Regenerate the specific board when wrong; never proceed with a raw board unless both realism passes failed (the run will say so).
- **Clips:** wait with `kilnry_workflows status` or `kilnry_jobs wait`; do not resubmit after timeouts.
- **QA failures:** the workflow re-renders the failing clip once with the corrected prompt; if it fails again, show the frames and ask.
- **Text overlay:** only if the user asked; subtitles, hook, or both, timed from the transcript.

## Deliver

One line with the path (relative to the Library), duration, aspect, and actual cost. Offer exactly one next step (post package, captions, a second variant). Keep model names and step ids out of the message unless asked; they are in the Run view.

## Modes in one sentence each

- **review**: creator on camera holds and uses the product, direct address, hook, main, closer.
- **product-only**: hands and POV only; the product is the hero; voiceover via the Narrator workflow or silence.
- **unboxing**: package, opening, reveal as the climax, first look, close.
- **try-on**: product alone, wearing, texture macro, styled pose; scale must match the body.
- **tutorial**: 3–7 steps with headings burned after render, CTA tail.
- **website**: hook, the site solves it, result; real screenshots captured locally slide in as cards.

## Files

- `workflows/ugc-ad.yaml`: the pipeline definition (read-only; edit copies in `~/.kilnry/workflows/`).
- `references/script-craft.md`: hooks, density, story shapes, claim handling.
- `references/board-and-clip.md`: board slot rules, clip prompt structure, QA checklist.

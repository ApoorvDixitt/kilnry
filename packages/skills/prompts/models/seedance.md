<!--
  Kilnry — https://github.com/ApoorvDixitt/kilnry
  Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
  SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
  See LICENSE.md in the repository root. You may not remove or obscure this notice.
-->

# Seedance 2.5

Seedance 2.5 makes 4–30 s clips at 480p or 720p with native audio, including lip-synced speech, and accepts up to 50 mixed references (images, video, audio) in reference-to-video mode. Write the shot as a director would: subject, action, camera, light, sound, in that order. Say who speaks and quote the line; the model performs it. One scene per clip; for multiple cuts, describe each cut with a duration ("Cut 1, 0–4 s: …"). Name references positionally ("the woman in image 1", "the bottle in image 2") and keep the anchor first. Ask for "natural room sound" or "no music" explicitly; silence is not the default. Avoid brand names and on-screen text. Prefer 720p for delivery and 480p for drafts; 1080p costs about five times 480p. No negative prompt; put exclusions in plain language ("no extra people").

Example 1: "Medium close-up, handheld phone look. The woman in image 1 holds the serum bottle from image 2 at chest height and says: 'Two drops, that's it. Fourteen days.' She smiles at the end. Bright apartment window light, natural room sound, no music, no on-screen text."

Example 2: "Cut 1, 0–5 s: top-down, hands open a kraft box on a wooden desk. Cut 2, 5–10 s: the product from image 1 is lifted into soft daylight, slow turn. Cut 3, 10–15 s: close-up of the label. Paper rustle and soft desk ambience, no speech."

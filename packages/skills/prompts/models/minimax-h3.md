<!--
  Kilnry — https://github.com/ApoorvDixitt/kilnry
  Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
  SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
  See LICENSE.md in the repository root. You may not remove or obscure this notice.
-->

# MiniMax H3

H3 produces 4–15 s at 480p, 768p, 2K (fal adds 4K) with native stereo audio and image, video, and audio references (first five images free on direct). It excels at motion design, stylised animation, and multi-cut choreography inside one clip when you spell out the cuts with timestamps. Always pass the aspect ratio explicitly (text-to-video requires a concrete ratio; image-to-video is adaptive). Prompt structure that works: style block, scene at 0 s, timestamped beats, one camera move, end state, audio cue. Ask for motion from frame one to avoid a frozen start. No negative prompt; state exclusions plainly. Kids content: avoid the tokens "child" and "kid"; use "small", "young", "naive".

Example 1: "Style: flat 2D vector, thick outlines, palette #F4A259 #2E4057 #F5F1E9, even light. 0–2 s: a paper airplane folds itself on a desk. 2–5 s: it lifts and circles a coffee mug. 5–8 s: it lands on an open notebook. 8–10 s: hold on the notebook. Camera locked. Soft paper sounds, no speech."

Example 2: "Style: glossy 3D product render, studio HDRI, charcoal backdrop. 0–3 s: the bottle from image 1 rises from a pool of liquid. 3–7 s: slow orbit, droplets fall. 7–10 s: it settles and the label faces camera, hold. Low ambient hum."

<!--
  Kilnry — https://github.com/ApoorvDixitt/kilnry
  Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
  SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
  See LICENSE.md in the repository root. You may not remove or obscure this notice.
-->

# ElevenLabs (text-to-speech, voice)

A voice model for narration and dialogue.

- Write the line as it should be spoken; punctuation shapes the delivery, so use it deliberately.
- Give direction in brackets sparingly if the voice supports it (a pause, a softer tone); do not overload.
- Keep a line to one breath's worth of speech; split long paragraphs into segments so timing stays natural.
- Use a bound voice through its `@mention` or a `provider:voice_id`; never paste raw ids into the prose.
- For a language other than the default, set the language explicitly so pronunciation matches.

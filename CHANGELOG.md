# Changelog

All notable changes to Kilnry are documented here. The format follows Keep a Changelog, and versions follow Semantic Versioning.

## [Unreleased]

### Added

- The spend ledger in Settings, with a group-by over provider, model, folder, character or day and a Comma-Separated Values export, so where the money went is visible without leaving the app (F-PRV-05).
- Dubbing and voice change in the transforms panel, routed through the same engine path as the other transforms with the language and voice inputs each needs (F-CRE-11).
- A control on the Voice tab to pick an existing preset or cloned voice and bind it to a character, so a voice can be reused without cloning again (F-CHR-08).

### Fixed

- Identity training, voice cloning and voice previews now price, budget-check and charge through the engine, each writing exactly one ledger row and one audit event instead of billing outside the budget (F-CHR-07, F-VOI-01, F-VOI-02).
- A read-only Model Context Protocol token may list and preview voices but is now refused when it tries to clone or delete one; the voices tool declares its per-action scope (F-MCP-05).
- The chat route validates the incoming message payload against the user-message schema at the boundary, and every job records who confirmed the spend as the user, the automatic policy or a Model Context Protocol token, never the sheet importer (F-CHT-01).
- A release build refuses to serve when the test-only mock hook is enabled, and the request-forgery exemption is scoped to the reindex path alone rather than any request carrying the doctor header (F-SET-08).
- The training and provider copy now matches the specification's durations and wording, and the message check keeps honest "not yet" copy while failing on a promise whose milestone has already shipped (F-CHR-07, F-SET-05).

### Changed

- The visual check compares each screen against a committed baseline instead of only capturing it, masks the regions that legitimately vary, and adds the missing Library dark baseline (F-CHR-03).
- A legacy 2025-11-25 Model Context Protocol client is driven through initialize and tools/list so the older protocol path is covered (F-MCP-08).
- The end-to-end chat scenario proves the three approved renders complete and waits on observable state rather than the clock (F-CHT-03).
- The continuous-integration FFmpeg install is pinned to 7.0.2, verified against its published checksum and cached across runs.

## [0.3.1] - 2026-09-23

### Added

- The forty-seven seed registry rows for Google, OpenAI, ElevenLabs, MiniMax, Higgsfield and Replicate, so their models price and route without a manual entry (F-PRV-02).
- The Create half of the Higgsfield scenario: Soul 2 appears in the model picker with its trains-on-inputs tag, the acknowledged-clause card, the real-person likeness confirm and the authoritative estimate (F-PRV-06).
- The Check status action for an ambiguous timeout, which re-polls the stored provider request instead of resubmitting it (F-JOB-04).
- The session-cap pause, which stops a Chat turn once the running spend would cross the session budget cap (F-CHT-02).
- The confirmer distinction, showing who approved a spend — the user, the automatic policy, or a Model Context Protocol token — in the Jobs table and the Chat Cost tab (F-CHT-03).

### Fixed

- The cross-site request forgery token was omitted across the composer, the chat transport, the preset drawer, save-as-preset, preset import and the disk banner; every mutating request now sends it (F-CHT-03).
- Six preset defects meant a preset run never finished in v0.3.0: resolve and save dropped the token, the resolve route did not return the engine's request-and-estimate pair, the drawer had no in-drawer Library picker for a media slot, a stale resolve answer could win over a newer one, a local media input was never uploaded, and "preset" was missing from the sidecar source enum (F-PRE-02).
- Lip-sync never ran in v0.3.0 because the media role was invalid, the audio was never attached, and the panel fields were passed as generation parameters; lip-sync now runs from a Library asset (F-CRE-11).
- Chat messages were rejected with a 403 because the streamed turn did not carry the cross-site request forgery token (F-CHT-01).
- The approval callback used an obsolete signature, so approval streams arrived with no priced plan (F-CHT-03).
- Explicit model pins were ignored, an approved job recorded the wrong source and approver, the Cost tab was inert and the session controls were absent, and the Jobs table left the Prompt and Model columns blank (F-CHT-03).
- Every chat spend was stamped as approved by the user regardless of who actually approved it (F-CHT-03).
- The summarised consent lines in the clone drawer are now labelled as the provider's summarised policy and linked to it (F-VOI-02).
- `kilnry_generate` routed on an absent capability instead of the one derived from the request kind (F-MCP-02).

### Changed

- The preset-run and export-bundle scenarios now drive the drawer and the dialog through the interface instead of calling the application programming interface directly (F-PRE-02, F-LIB-14).

## [0.3.0] - 2026-09-22

### Added

- Chat and Agent screen: bring your own language model (OpenRouter by default, Anthropic, OpenAI or Google direct, or a local Ollama model) with the per-million-token price shown (F-CHT-01).
- Autonomy toggle — Ask me first or Run automatically — with a session budget cap that meters spend and stops the turn before it is crossed (F-CHT-02).
- Tool calls render as collapsible ToolCallCards; a spending call renders an ApprovalCard with the planned cost before any charge (F-CHT-03).
- A split-pane Chat screen: the thread on the left and a Workspace on the right with Preview, Steps and Cost-ledger tabs (F-CHT-04).
- Attach Library assets and Characters to a message, including dragging an asset in from the Library (F-CHT-05).
- Skills discover-then-load: the agent lists skills and loads one on demand (F-CHT-06).
- The Kilnry base system prompt with the routing table, cost rules and language mirroring, assembled into the model instructions (F-CHT-07).
- Media understanding: the agent can look at an attached image, video frame or audio through the vision-language route (F-CHT-10).
- Chat settings: default model, autonomy, session cap and the Ollama URL (F-SET-05).
- Skill format (`SKILL.md` plus `metadata.kilnry`) with a loader and validator, and real `kilnry_skills` list and load (F-SKL-01).
- A system-prompt library: the base prompt, per-mode addenda and six per-model guides (F-SKL-05).
- Preset catalogue with the eight category tabs and cards showing model, indicative cost and a needs-key badge (F-PRE-01).
- Preset use drawer with a field per slot, a cost strip and Run through the engine (F-PRE-02).
- Preset JSON format with slots, defaults, a prompt scaffold, negative prompt, params and a validator (F-PRE-03).
- Import a preset from a dropped file or a pasted link (F-PRE-04).
- Forty seed presets that run with only a fal key or only an OpenRouter key (F-PRE-05).
- Camera and motion presets as image-to-video scaffolds that run on whichever key you have (F-PRE-06).
- Save the current composer as a preset, choosing which fields become slots (F-CRE-12).
- Transforms panel for upscale, background removal, reframe and outpaint, lip-sync and transcription (F-CRE-11).
- Spend ledger grouped by provider, model, folder, character or day, with CSV export (F-PRV-05).
- Opt-in Higgsfield with its terms-of-use notice shown verbatim and gated before the key is saved (F-PRV-06).
- Price staleness guard that refuses to price with data older than thirty days unless overridden, with the override recorded in the audit log (F-PRV-07).
- Ollama detection on localhost with its model list, without counting as egress when off (F-PRV-08).
- Provider adapters for Google Gemini, OpenAI, ElevenLabs, MiniMax, Higgsfield and the training subset of Replicate (F-PRV-01).
- Train an identity behind the consent gate — fal FLUX LoRA, Replicate fast-flux or Higgsfield Soul ID — with the cost, provider terms and time shown and the artefact copied to disk (F-CHR-07).
- Bind a voice to a Character: pick a preset or clone one (F-CHR-08).
- Character versioning: editing references or the descriptor forks a new version, jobs pin the version they used, and `@handle@v1` resolves (F-CHR-10).
- Cast builder that generates an anchor plus three alternates from a few traits (F-CHR-15).
- Build a product Element from a URL through the guarded fetch, keeping only the claims you tick (F-ELM-04).
- Clone a voice with a consent checkbox showing the provider text, a price and a name (F-VOI-02).
- Disk-space banner at ninety percent with a Clear cache action (F-LIB-13).
- Export a bundle with metadata options: keep or strip embedded metadata and add the IPTC "trained algorithmic media" provenance label (F-LIB-14).
- MCP resources for assets, characters, skills and runs (F-MCP-03).
- MCP prompt starters: brief, UGC ad, character sheet and review (F-MCP-04).
- MCP legacy-client compatibility so 2025-era clients work on the same endpoint (F-MCP-08).
- Check the status of a timed-out job without resubmitting, so an ambiguous timeout never bills twice (F-JOB-04).

### Fixed

- The Model Context Protocol client matrix now reports only what it actually ran, and its transcripts no longer claim PASS for clients that were never executed (F-MCP-02).
- Every workspace package version is aligned with the released version so `kilnry --version` and the launcher size check report it (release plumbing).
- The forty seed presets were corrected to the ones the specification lists, replacing an earlier invented set (F-PRE-05).
- Preset media and character slots are filled through the attachment tray and the `@` picker (F-PRE-02).
- Summarised voice-clone consent lines are labelled "(provider policy, summarised)" with a link to the provider's policy (F-VOI-02).
- `kilnry_generate` derives the request capability from its kind so the router matches a model instead of returning NO_PROVIDER on the Model Context Protocol path (F-MCP-02).

## [0.2.0] - 2026-09-21

### Added

- Characters tab: a card grid with anchor thumbnail, `@handle`, tags, version and usage count (F-CHR-01).
- Create a Character from one photo, a Library asset, or a text description; the cast builder is present but disabled until a later milestone (F-CHR-02).
- Character detail with a reference sheet, identities, voice, usage and settings tabs; the training and cloning actions are disabled until a later milestone (F-CHR-03).
- Reference-sheet pipeline that turns an anchor into turnaround view files and an expression grid, pausing at an approval checkpoint before spending on the rest (F-CHR-04).
- A vision-language appearance descriptor with visual anchors and negative traits, generated at creation and editable (F-CHR-05).
- A consent and licence gate that blocks training and likeness use for a real person until consent is set (F-CHR-06).
- `@handle` mentions in any prompt resolve to the best consistency input for the chosen model, with a hover preview of what will be sent (F-CHR-09).
- Usage tab and a Library filter that shows every asset made with a character (F-CHR-11).
- A three-or-more-people warning surfaced in the composer for multi-character scenes (F-CHR-13).
- Elements tab for props, environments and styles with `@handle` mentions (F-ELM-01).
- Create an Element from an asset or upload, with state variants kept as linked but separate Elements (F-ELM-02).
- Element injection sends the reference with an appearance-only instruction (F-ELM-03).
- Voices tab listing provider presets with language, gender, style tags and price; previews arrive with the providers in a later milestone (F-VOI-01).
- `@voice` mentions bind a voice to a Character in the resolver (F-VOI-04).
- `@` mention autocomplete in the composer with a live preview of what each mention injects (F-CRE-02).
- Variants and a batch of up to twelve independent prompts through the same estimate and generate paths (F-CRE-09).
- Edit mode: pick a Library asset, describe the change, and route to image edit or video-to-video (F-CRE-10).
- Smart folders: saved searches shown in the Library tree (F-LIB-07).
- Recover a lost sidecar from a file's embedded metadata, and `kilnry doctor --reindex` (F-LIB-11).
- Free-form tags and colour labels on assets, filterable in search (F-LIB-12).
- A Model Context Protocol server over loopback HTTP at `/mcp` with bearer tokens, plus a stdio bridge `npx kilnry mcp` (F-MCP-01).
- Twenty MCP tools with annotations, structured output and short descriptions, backing Chat and MCP from one implementation (F-MCP-02).
- Per-client MCP tokens with names, scopes, last-used and revoke, and Settings › MCP with the four client connection snippets (F-MCP-05).
- Spending tools confirm the cost before charging and honour budget caps (F-MCP-06).
- Offline resilience: jobs queue while offline and resume, re-polling running jobs by provider id on reconnect (F-JOB-05).

### Fixed

- The one-time setup link now regenerates on every boot so an install can never lock itself out (F-ONB-01).
- Edit mode reads its source on the server so the composer is in the initial HTML and the slash-to-focus shortcut works (F-CRE-10).
- The agent-prompt-file check is narrowed to the places agent files live, so product prompt assets are allowed (D-47a).

## [0.1.0] - 2026-09-20

Kilnry v0.1.0 · first usable build (M1–M3).

### Added

- Create composer with Image, Video and Audio modes that keeps your prompt when you switch (F-CRE-01).
- Model picker that lists models by price, explains why some are unavailable, and shows a Demo badge on the free Pollinations model (F-CRE-03, F-CRE-13).
- Parameter chips that offer only the settings a model accepts and snap the rest to the nearest allowed value (F-CRE-04).
- Attachment tray for adding reference media with a role, refusing private-network URLs (F-CRE-05).
- Cost strip that shows the price, output size and wait before you generate, rolling the figure and turning coral when a generation would pass a budget cap (F-CRE-06).
- Generate lifecycle that prices, confirms, reserves budget and shows the result appear in place (F-CRE-07).
- Result-tile actions to reuse a prompt, re-run, open in the Library, copy the path and delete (F-CRE-08).
- A clear, not-charged tile when a provider blocks a prompt, with an edit-prompt recovery (F-CRE-14).
- Library folder tree backed by the real filesystem, with create, rename, move and delete under the Library root (F-LIB-01).
- Virtualised asset grid that scrolls ten thousand items smoothly, with hover-scrub video previews (F-LIB-02).
- Sidecar-first metadata edits so tags, label, rating and notes are written beside the file first (F-LIB-03).
- Inspector drawer with Info, Provenance and Activity tabs (F-LIB-05).
- One-line Library search with words and filters such as type, since and cost (F-LIB-06).
- Selection bar with delete to Trash and restore (F-LIB-08).
- Full-screen asset viewer at its own address, served over Range requests (F-LIB-09).
- Jobs table showing every job with status tabs, cost, cancel and retry (F-JOB-01).
- Daily and monthly budget caps shown live in the composer, blocking or asking before an overspend, with the one-time override recorded in the audit log (F-PRV-04).
- Budget settings page to set caps and the at-cap behaviour (F-SET-04).
- Appearance settings for theme, density and reduced motion, persisted across restarts (F-SET-09).
- Security audit log on the Security page listing recent events with an Export JSON action, completing the second-milestone promise (F-SET-08).
- Getting-started checklist that ticks itself off as you generate, organise and connect (F-ONB-05).
- Import an existing folder of media in place, writing sidecars and thumbnails without moving the originals (F-ONB-07).
- Keyboard shortcuts throughout, with a help panel on the question mark; the canonical motion moments from the design's motion specification.

### Fixed

- Library roots inside hidden folders were never watched, so files added or renamed there were not indexed; the watcher now decides what to ignore relative to the Library root (F-LIB-04).

<!-- Kilnry © 2026 Apoorv Dixit · Sustainable Use License 1.0 · See LICENSE.md. -->

# Changelog

All notable changes to Kilnry are documented here. The format follows Keep a Changelog, and versions follow Semantic Versioning.

## [Unreleased]

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

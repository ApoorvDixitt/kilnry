# Changelog

All notable changes to Kilnry are documented here. The format follows Keep a Changelog, and versions follow Semantic Versioning.

## [Unreleased]

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

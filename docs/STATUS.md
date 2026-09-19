# Build status

## Bootstrap · 2026-09-19

Status: complete. Bootstrap checks and the GitHub `ci` workflow passed.

The repository was created from the locked Kilnry specification package. Repository hygiene, licence enforcement, provenance checks, and the pnpm workspace passed the first gate.

Owner override, 2026-09-19: commits are pushed directly to `main` without pull requests or branch protection for now. The owner will enable protection manually later. This overrides D-49's bootstrap workflow but not its prohibition on force pushes or history rewrites.

Owner override, 2026-09-19: commits use the repository-local owner name and noreply email without cryptographic signing. No SSH public key was uploaded.

Resolved package conflicts:

- D-15 overrides the repository skill's MIT default: Kilnry is fair-code under the Sustainable Use License 1.0.
- D-46 overrides stale Renovate and release-please references: dependency and release commits are local owner commits.
- D-47 overrides tracked `AGENTS.md` examples: the local copy is excluded through `.git/info/exclude`.
- The feature map overrides stale wireframe navigation and onboarding copy.
- D-11 overrides the MCP chapter's custom-server wording: the app uses Next standalone with Route Handlers and `instrumentation.ts`.

Bootstrap dependency default (adjustable): pnpm 12's build-script gate explicitly allows `esbuild` because the pinned `tsx` runner requires its platform binary. Other lifecycle scripts remain denied unless canon names them.

## M1 · Foundation · 2026-09-19

Status: complete. Local gates passed; the corresponding GitHub `ci` run is the published verification.

Implemented F-ONB-01's local boot/token foundation, F-ONB-02, F-ONB-03, and F-ONB-06. The Next 16 shell has the eight canonical destinations, light/system/dark theming, reduced-motion support, keyboard navigation, command palette, and the D-32 warm-charcoal palette. Better Auth protects one local account. PGlite migrations create all 36 canonical tables. The launcher exposes version/licence output and a zero-egress doctor.

Gate results:

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:browser`: pass.
- `pnpm e2e --grep @smoke`: pass, including hostile Host rejection, account and Library creation, private-window login, axe on `/welcome` and `/create`, and light/dark screenshots.
- `pnpm build`, `pnpm audit --prod`, `pnpm check:canon`, `pnpm check:size`: pass. The optimized standalone server returns healthy and rejects a hostile Host with 421.
- `kilnry doctor`: 0 failures, 0 warnings.

Deferred by canonical milestone: provider key onboarding F-ONB-04 to M2; checklist behavior F-ONB-05 to M3; launcher release download and browser-open packaging finish in M8.

Defaults (adjustable): production builds use isolated in-memory PGlite while collecting routes so parallel build workers never touch the live data directory. With a `src/` App Router, `src/proxy.ts` is used because the root location was not executed by Next 16.3. FFmpeg major versions newer than 7 satisfy the doctor check.

## M2 · Providers, Library core, Job engine · 2026-09-19

Status: complete. Local gates and GitHub [`ci` run 35411204214](https://github.com/ApoorvDixitt/kilnry/actions/runs/35411204214) passed.

Completed F-ONB-04; F-CRE-13; F-LIB-03, F-LIB-04, F-LIB-10, F-LIB-11; F-PRV-01, F-PRV-02, F-PRV-03, F-PRV-07; F-JOB-02, F-JOB-03, F-JOB-04; F-SET-01, F-SET-02, F-SET-08. This includes envelope-encrypted provider keys and recovery, redaction, fal/OpenRouter/Pollinations setup, canonical model and price registries, authoritative estimation, constrained Auto routing, provider adapters, durable jobs on shared PGlite, canonical media finalization, Library indexing and recovery, Range media delivery, SSE events, secured generation routes, and the minimal M2 proof UI.

Gate results:

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:browser`, `pnpm e2e --grep @smoke`, all canon/header/provenance/i18n/size checks, `pnpm audit --prod`, and `pnpm build`: pass.
- TRD-19 G-01…G-30 estimator goldens and staleness paths: pass. Strict MSW fal/OpenRouter matrices cover success, moderation, 429, 5xx, timeout, insufficient funds, and ambiguous submit without paid egress.
- Crash-resume polls accepted work without resubmission; mid-submit crash becomes ambiguous. Reindex equality, sidecar recovery, moderation-zero ledger, idempotency, cancellation, concurrency, and no-key zero-egress: pass.
- `gitleaks` found no secrets. Light and dark 1440×900 M2 route screenshots were visually checked for clipping, overlap, states, accent use, and minimum text size.

Resolved canon conflicts: pg-boss 12.33 rejects `:` in physical queue names, so logical `gen:<provider>` queues map internally to `gen/<provider>`. TRD-19's explicit G-17 value ($1.517) overrides its inconsistent formula result ($1.512). The owner's canonical file → sidecar → embedded metadata → database → derivatives order overrides stale chapter ordering; the sidecar is refreshed after embedding before the database write.

Manual-only check: no real provider key or paid request was used. With an owner-supplied key and approval for the displayed exact spend, connect fal in Settings, run its connection test, confirm one image generation, verify media + sidecar + derivative + terminal ledger entry, then remove the key. This procedure was documented, not executed.

<!-- Kilnry © 2026 Apoorv Dixit · Sustainable Use License 1.0 · See LICENSE.md. -->

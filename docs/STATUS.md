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

Status: complete after a second source-level audit and remediation pass. GitHub [`ci` run 35426946068](https://github.com/ApoorvDixitt/kilnry/actions/runs/35426946068) passed on the final implementation head.

Completed F-ONB-04; F-CRE-13; F-LIB-03, F-LIB-04, F-LIB-10, F-LIB-11; F-PRV-01, F-PRV-02, F-PRV-03, F-PRV-07; F-JOB-02, F-JOB-03, F-JOB-04; F-SET-01 and the M2 foundations of F-SET-02/F-SET-08. Core blocks now include authoritative confirmation, transaction-serialized budget reservations, provider-price ingestion, stale-submit refusal, D-42 routing, encrypted keys with machine binding and recovery proof, strict request security, durable jobs, resumable downloads, multi-output finalization, embedded metadata and recovery, bounded derivatives, watcher/reindex, Range/SSE routes, and paid plus free demo generation.

Gate results:

- Every required command passes: lint, both type checks, unit/integration, browser, smoke E2E, canon/header/provenance/i18n/size, production audit, and build.
- 94 core, 22 provider, 7 media, and 3 browser tests pass. G-01…G-30, strict fal/OpenRouter matrices, Pollinations, live-price persistence, moderation-zero ledger, atomic caps, idempotency, concurrency, cancellation, multi-output, reindex equality, A1111/Comfy/XMP/GLB recovery, and no-key zero-egress are covered.
- A subprocess is killed with `SIGKILL` during polling; restart re-polls the stored provider request and completes with zero submissions in the new process. Ambiguous submit remains single-call and user-gated.
- Host/Origin, CSRF, request IDs, rate limits, SSRF ranges/redirects, path containment, redaction shapes, derivative IDs, and gitleaks pass. Light/dark 1440×900 Provider and Security screenshots were inspected.

Resolved canon conflicts: pg-boss 12.33 rejects `:` in physical queue names, so logical `gen:<provider>` queues map internally to `gen/<provider>`. TRD-19's explicit G-17 value ($1.517) overrides its inconsistent formula result ($1.512). The owner's canonical file → sidecar → embedded metadata → database → derivatives order overrides stale chapter ordering; the sidecar is refreshed after embedding before the database write.

Core-scope boundary: full Workspace backup/export/root-migration controls remain with their later packaging/UI work; M2 includes root validation, indexing, reindex, watcher, caches, and recovery.

Manual-only check: no real key or paid request was used. With an owner-supplied key and explicit approval for the displayed spend, connect fal, test, generate one image, verify file + sidecar + derivative + ledger, then remove the key. Documented, not executed.

<!-- Kilnry © 2026 Apoorv Dixit · Sustainable Use License 1.0 · See LICENSE.md. -->

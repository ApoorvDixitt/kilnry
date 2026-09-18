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

<!-- Kilnry © 2026 Apoorv Dixit · Sustainable Use License 1.0 · See LICENSE.md. -->

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

## M3 · Create, Library UI, Jobs, Budget · 2026-09-20

Status: complete. GitHub [`ci` run 35473190455](https://github.com/ApoorvDixitt/kilnry/actions/runs/35473190455) passed on the final head.

Implemented F-CRE-01, 03, 04, 05, 06, 07, 08, 14; F-LIB-01, 02, 03, 05, 06, 08, 09; F-JOB-01; F-PRV-04; F-SET-04, F-SET-09; F-ONB-05, F-ONB-07; the canonical motion moments; the F-SET-08 security audit log; and the restored F-CRE-13 Demo badge. The composer calls the M2 engine through `/api/estimate` and `/api/generate`; it never reimplements pricing or budget.

Gate results:

- Every required command passes: lint, typecheck, `test` (126 core, 22 provider, 13 media, 1 web), `test:browser` (97), smoke and acceptance E2E, canon/header/provenance/i18n/size, `audit --prod`, build.
- Acceptance scenarios (PRD-21 numbering, by topic) S-01, S-02, S-07, S-08, S-09, S-13, S-14, S-25 and the unnumbered M3-VID pass as Playwright tests under strict mock service worker; continuous integration runs `@m3|@gate`.
- Library performance: 10,000 synthetic assets scroll with a 95th-percentile main-thread frame time of 3.5 ms.
- Keyboard, accessibility (axe WCAG 2.2 AA, zero critical or serious on every touched route), reduced motion (operating system and Appearance) and the green-means-money accent lint pass.

Resolved canon conflicts:

- PRD-21 scenario numbers are by topic, not by milestone; `MILESTONES.md` and `VERIFICATION.md` were corrected on 2026-09-19.
- Library search uses ILIKE substring matching instead of a `tsvector` column (default; adjustable).

Notes and decisions:

- S-13 (rename outside Kilnry) failed until a real bug was fixed: the watcher ignored files whenever the Library root sat under a hidden folder; it now decides relative to the root (F-LIB-04). The scenario runs in the acceptance suite.
- The audit log was built to complete F-SET-08, promised in M2 but never implemented.
- The visual baseline is capture-only; a `toHaveScreenshot` comparison with masked dynamic areas, captured on the continuous-integration platform, is the M4 follow-up.
- The video scenario now runs in continuous integration. It had failed there because the Ubuntu runner ships no FFmpeg, so it and the media pipeline unit test were skipping; continuous integration now installs FFmpeg 7 first.
- The commit-subject check bans "updates"; it will need an exemption when the Updates page is built.
- v0.1.0 was tagged by hand, not with `pnpm release minor`, because `commit-and-tag-version` rewrites the changelog and would discard the plain-English feature list.
- M3 was completed across two agent sessions; no tracked file depends on either agent.

## M4 · Characters, Elements, Voices, MCP · 2026-09-21

Status: complete. GitHub [`ci` run 35531635405](https://github.com/ApoorvDixitt/kilnry/actions/runs/35531635405) passed on the final head before the release.

Implemented F-ONB-01 (fix); F-CHR-01, 02, 03, 04, 05, 06, 09, 11, 13; F-ELM-01, 02, 03; F-VOI-01, 04; F-CRE-02, 09, 10; F-LIB-07, 11, 12; F-MCP-01, 02, 05, 06; F-JOB-05. The six TRD-14 §7 worked examples pass byte-exact as unit tests; every new Generate surface goes through the M2 engine's estimate, budget and confirmation.

Test counts by suite (uncached `turbo run test --force`): core 235, provider 22, media 27, launcher 16, mcp, web node 40; `test:browser` 102; `e2e --grep @m4` 8; `e2e --grep "@m3|@gate"` 13. Keyboard, axe WCAG 2.2 AA (zero critical or serious on every touched route), reduced motion (both switches) and the accent lint pass; light and dark 1440×900 screenshots are in `e2e/output/`, and `e2e/__snapshots__/characters-{light,dark}.png` are the Characters baseline against `glance-characters{,-dark}.png`.

MCP matrix (`@matrix`, `KILNRY_TEST_MSW=1`) marks PASS only for what it runs. `endpoint-http.json`: a Streamable HTTP check that `tools/list` is 20 tools, byte-identical across two calls, with annotations, plus the cache hint, the `kilnry_generate` money-round-trip and a `resources/list` read. `stdio-bridge.json`: a real round-trip through the launcher `kilnry mcp` bridge asserting the same 20 tools. MCP Inspector `--cli` is PASS only when it answers non-interactively, else manual-only. Claude Code (HTTP and stdio), Codex CLI, Claude Desktop and Cursor are manual-only with their snippet and check.

Notes and decisions:

- `5a20fd7` (F-CHR-01) had its run cancelled by the old cancel-in-progress; later green runs verify it. `2ad270d` set it false.
- The FFmpeg-in-CI failures were the static-build host being unreachable, not the code; the install now retries via `nick-fields/retry`.
- Base system prompt: `packages/skills/prompts/base-system.md` (TRD-13 §8, TRD-11 §3) wins over PRD-13 §1's unused `packages/core/src/agent/system-prompt.md`.
- `c0eb5c1`'s subject reads `(F-CHR-11)` but the change is F-LIB-11; history is not rewritten.
- `08f4a9f` only planned the reference sheet; `c52eeea` runs it through the engine, splits panels with sharp, and writes role/view/lineage sidecars.
- Not-available MCP operations by owning milestone: `kilnry_library_manage.export_bundle`, `kilnry_voices` preview/clone, most `kilnry_transform` ops → M5; `kilnry_ffmpeg` and `kilnry_analyze` extras → M6/later; presets/workflows/skills lists → M5/M6; `kilnry_publish` → deployer (D-17); `kilnry_transform` face-swap always rejects.
- F-CHR-13, F-ELM-03 and F-VOI-04 are surfaced in the composer and covered by the `@m4` scenarios.
- MCP tokens are 32-byte secrets stored as a SHA-256 hash compared in constant time (high-entropy, not argon2id; default; adjustable).

## M5 · Chat, Presets, providers, training · 2026-09-23

Status: complete. GitHub [`ci` run 35812697387](https://github.com/ApoorvDixitt/kilnry/actions/runs/35812697387) passed on the acceptance head `1ffd7db`.

Implemented across M5 and its acceptance follow-ups: F-CHT-01, 02, 03, 04, 05, 06, 07, 10; F-SET-05; F-SKL-01, 05; F-PRE-01, 02, 03, 04, 05, 06; F-CRE-11, 12; F-PRV-02, 05, 06, 07, 08 and the Google, OpenAI, ElevenLabs, MiniMax, Higgsfield and Replicate-training adapters; F-CHR-07, 08, 10, 15; F-ELM-04; F-VOI-02; F-LIB-13, 14; F-MCP-03, 04, 08; F-JOB-04. The fifty seed registry rows for the six later providers, the S-23 Create half (Soul 2 with its trains-on-inputs tag, the acknowledged-clause card, the real-person confirm, the authoritative estimate), the S-16 second half (speech then lip-sync), S-24 end to end, the Check status action, the cross-site request forgery fixes, the six preset defects, lip-sync, the confirmer stamp and the gate routes with real Character cards all land in this milestone.

Acceptance: S-16, S-23 and S-24 are automated `@m5` Playwright scenarios driving the interface under strict mock service worker; S-11, S-15, S-17, S-18 too. The only manual check is the once-against-a-real-fal-key training run. Reconciliations: Product Requirements Document 21's ApprovalCard title and Total ≈ $1.26 are aligned with chapter 11's Budget reached card; the $0.0043 speech strip shows without ≈ because MiniMax returns its own estimate; chapter 05 §11's wording is "12 s → billed as 15 s". S-24 asserts the three approved jobs exist with `confirmed_by` user and source chat and that no further provider request follows, not that the renders complete — a deliberate trade for shared-runner time made in `1ffd7db`, with job completion covered by S-05 and the smoke.

Cadence record: three scenario commits were pushed before the preceding pending run finished, and `fccfb4d` re-ran green afterwards; later red runs were fixed forward without rewriting any published commit.

Test counts by suite (uncached `turbo run test --force`): core 306, agent 89, providers 57, presets 253, skills 3, media 17, launcher 8, mcp 5, db 1, web node 90; `test:browser` 187.

Decisions where the specification was silent (default; adjustable) and their M6 follow-ups are listed in the milestone entry above and kept: word-ratio token estimate, hand-rolled skill frontmatter, server-side preset resolve, capabilities injected into tool services, freeze-at-submit versioning, transform availability, C2PA signing note only, and image-only metadata strip. Not-available Model Context Protocol operations remain `kilnry_transform` dubbing, voice_change and reframe_video (M6/M7), `kilnry_workflows` (M6), `kilnry_publish` (M7) and C2PA export signing (M6).

<!-- Kilnry © 2026 Apoorv Dixit · Sustainable Use License 1.0 · See LICENSE.md. -->

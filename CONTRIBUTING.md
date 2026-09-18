# Contributing

Thanks for improving Kilnry.

## Development setup

```sh
corepack enable
pnpm install
pnpm dev
```

Kilnry uses Node.js 24 and pnpm 12. Run the full local gate before sharing a change:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm test:browser
pnpm e2e --grep @smoke
pnpm check:canon
```

Automated tests must use fixtures and must never call a paid provider.

## Contribution areas

- Provider adapter: implement the canonical adapter interface, redact secrets, add MSW fixtures, and document pricing provenance.
- Skill: author original `SKILL.md` instructions and declarative steps. Do not copy vendor workflow or prompt text.
- Preset: add a schema-valid JSON preset with realistic inputs, a price hint, and fal or OpenRouter compatibility.
- Workflow: add schema-valid YAML, a priced plan, approval checkpoints, fixture coverage, and original prose.

## Commits

Use atomic Conventional Commits. Include the feature ID when a feature is touched, for example `feat(create): F-CRE-06 show authoritative cost`.

Do not add coding-agent instruction files, credentials, telemetry, paywalls, or bot-authored dependency changes.

## Pull requests

External contributions may use a branch and pull request. Describe the F-IDs and D-IDs involved, include the exact checks run, and attach light and dark screenshots for UI changes.

## Code of Conduct

Participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

<!-- Kilnry © 2026 Apoorv Dixit · Sustainable Use License 1.0 · See LICENSE.md. -->

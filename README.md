# Kilnry

> Create AI images, video, audio, characters, and workflows on your own machine while keeping your files and seeing every dollar before it is spent.

[![CI](https://github.com/ApoorvDixitt/kilnry/actions/workflows/ci.yml/badge.svg)](https://github.com/ApoorvDixitt/kilnry/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Sustainable%20Use%201.0-007A4B)](LICENSE.md)

Kilnry is a local-first AI media studio. It runs the web app, job worker, and MCP server in one process on your computer. You bring provider keys; Kilnry adds no markup, telemetry, cloud account, or paywall.

## Install

```sh
npx -y kilnry
```

The launcher opens `http://127.0.0.1:3123`, guides you through creating a local account and choosing a Library folder, then lets you connect a provider. The npm launcher will be available with the first packaged release.

## Development quickstart

```sh
corepack enable
pnpm install
pnpm dev
```

Open `http://127.0.0.1:3123`. Provider calls in automated tests are always mocked; tests never spend real money.

## What it ships

- A local Next.js studio for Create, Library, Characters, Presets, Workflows, Chat, Jobs, and Settings.
- Ordinary media files with `*.kilnry.json` provenance sidecars in a folder you choose.
- Bring-your-own-key provider routing with cost estimates, budgets, and confirmation before submission.
- Twenty MCP tools shared by the UI and Chat.
- An npm launcher, standalone platform archives, and a Docker image.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md), the [Code of Conduct](CODE_OF_CONDUCT.md), and the deliberately narrow [roadmap](docs/ROADMAP.md).

## Security

Please report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

Kilnry is fair-code (Sustainable Use License 1.0). It is free to use, including for your own business. It is not licensed for resale, hosting for others, or white-labelling. See [LICENSE.md](LICENSE.md).

<!-- Kilnry © 2026 Apoorv Dixit · Sustainable Use License 1.0 · See LICENSE.md. -->

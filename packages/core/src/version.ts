// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The single source of the Kilnry version in code. Every package.json in the
// monorepo carries the same version (the release bump touches all 14), so the
// core package's own package.json is the app version. Read once via
// createRequire so a bundle manifest, the About screen (F-SET-11) and the CLI
// state the version that actually shipped rather than a hard-coded literal.

import { createRequire } from 'node:module';

let cached: string | undefined;

export function appVersion(): string {
  if (cached !== undefined) return cached;
  const require = createRequire(import.meta.url);
  const pkg = require('../package.json') as { version?: string };
  cached = typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  return cached;
}

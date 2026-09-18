#!/usr/bin/env node
// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import('../dist/cli.js').catch((error) => {
  process.stderr.write(`Kilnry could not start: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { chmodSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const gitDir = join(process.cwd(), '.git');
if (!existsSync(gitDir)) {
  process.stdout.write('Skipping hook installation outside a Git working tree.\n');
  process.exit(0);
}

const hook = `#!/bin/sh
# Kilnry — https://github.com/ApoorvDixitt/kilnry
# Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
# SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
# See LICENSE.md in the repository root. You may not remove or obscure this notice.
set -eu
pnpm check:headers
pnpm check:provenance
pnpm check:canon
`;
const path = join(gitDir, 'hooks', 'pre-commit');
writeFileSync(path, hook, { encoding: 'utf8', mode: 0o755 });
chmodSync(path, 0o755);
process.stdout.write('Installed the Kilnry pre-commit hook.\n');

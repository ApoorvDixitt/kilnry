// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Write core's build-time version pins (F-61); see scripts/versions.ts.

import { writeFileSync } from 'node:fs';
import { buildPins, GENERATED_PATH, renderGenerated } from './versions';

const pins = buildPins();
writeFileSync(GENERATED_PATH, renderGenerated(pins), 'utf8');
process.stdout.write(`Wrote ${GENERATED_PATH}: Next ${pins.next}, PGlite ${pins.pglite}.\n`);

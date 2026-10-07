// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The child manifest-crash.test.ts SIGKILLs: it rewrites one run's manifest in
// a loop with the writer persistRun uses, alternating two large versions so a
// kill is likely to land inside a write.

import { writeRunManifestFile } from './run-manifest-file';

const dir = process.argv[2];
if (!dir) throw new Error('a run folder is required');
const step = (n: number) => ({ step_id: `s${n}`, status: 'completed', outputs: { assets: [`asset-${n}`] } });
const versions = ['A', 'B'].map((version) => ({
  version,
  steps: Array.from({ length: 20_000 }, (_, n) => step(n)),
}));
let count = 0;
for (;;) {
  writeRunManifestFile(dir, versions[count % 2]);
  count += 1;
  if (count === 3) process.stdout.write('WRITING\n');
}

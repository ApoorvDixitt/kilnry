// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The web app's node test config. The install-route test boots a file-backed
// embedded PGlite database, and its emscripten runtime has aborted at process
// exit when its fork was shared with another PGlite-booting file running in
// parallel (F-JOB-02). Two projects keep every other file in the fast parallel
// pool while the install-route test runs alone in its own fork with file
// parallelism off, so no second PGlite instance ever shares its process.
import { defineConfig } from 'vitest/config';

const EXCLUDE = ['src/**/*.browser.test.tsx', '.next/**', 'node_modules/**'];
const ISOLATED = 'src/app/api/skills/install/route.test.ts';

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'web',
          include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
          exclude: [...EXCLUDE, ISOLATED],
        },
      },
      {
        extends: true,
        test: {
          name: 'web-pglite-isolated',
          include: [ISOLATED],
          exclude: EXCLUDE,
          // Run this PGlite-booting file alone in its own fork so no other
          // embedded database shares its process and aborts it at exit.
          fileParallelism: false,
          isolate: true,
        },
      },
    ],
  },
});

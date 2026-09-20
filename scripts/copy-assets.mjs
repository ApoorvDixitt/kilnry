// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Copy non-TypeScript product assets (prompt markdown files) from a source tree
// into the compiled output tree, preserving relative paths, so modules can load
// them at runtime relative to their own location in dist. Usage:
//   node scripts/copy-assets.mjs <srcDir> <distDir> <suffix>

import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const [, , srcArg, distArg, suffix] = process.argv;
if (!srcArg || !distArg || !suffix) {
  process.stderr.write('usage: copy-assets.mjs <srcDir> <distDir> <suffix>\n');
  process.exit(1);
}

const root = process.cwd();
const srcDir = resolve(root, srcArg);
const distDir = resolve(root, distArg);

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full);
    } else if (full.endsWith(suffix)) {
      const target = join(distDir, relative(srcDir, full));
      mkdirSync(dirname(target), { recursive: true });
      cpSync(full, target);
      process.stdout.write(`copied ${relative(root, full)} -> ${relative(root, target)}\n`);
    }
  }
}

if (existsSync(srcDir)) walk(srcDir);

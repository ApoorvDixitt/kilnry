// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Where the shipped prompt library and skill catalogue live on disk. The Chat
// runtime rebuilds its system prompt from these files on every request
// (TRD-11 §3), so it needs a real path rather than a guess. Both folders are
// listed in this package's files field, which means they are present whether the
// app runs from the repository or from an installed copy.
//
// The resolvers walk up from this module: in development it sits in src/, after
// a build it sits in dist/, and the prompts folder is a sibling of both.

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function packageRoot(): string {
  // src/index.ts → packages/skills ; dist/index.js → packages/skills
  const here = dirname(fileURLToPath(import.meta.url));
  const parent = resolve(here, '..');
  return existsSync(join(parent, 'prompts')) ? parent : here;
}

/** The prompt library folder: base-system.md, modes/ and models/ (TRD-13 §8). */
export function promptLibraryRoot(): string {
  return join(packageRoot(), 'prompts');
}

/** The bundled skill catalogue folder (TRD-13 §1). */
export function bundledSkillsRoot(): string {
  return join(packageRoot(), 'skills');
}

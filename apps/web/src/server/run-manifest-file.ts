// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The run folder's run.kilnry.json, written to a temporary file and renamed so
// the file on disk is always one whole manifest (TRD-05 §13). Its own module so
// the crash test can run exactly this code in a child process (D-66, H-2).

import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The temporary file a run manifest is written to before its rename. It was
 * `run.kilnry.json.tmp`, which the Library watcher's rule
 * (`/\.kilnry\.json\.tmp-.*$/`, watcher.ts) does not match, so every manifest
 * write enqueued an import of a file that was gone by the time it ran (F-102).
 */
export function manifestTempPath(target: string): string {
  return `${target}.tmp-${process.pid}`;
}

/** Write `<dir>/run.kilnry.json` through a temporary file and a rename. */
export function writeRunManifestFile(dir: string, manifest: unknown): void {
  mkdirSync(dir, { recursive: true });
  const target = join(dir, 'run.kilnry.json');
  const tmp = manifestTempPath(target);
  writeFileSync(tmp, JSON.stringify(manifest, null, 2), 'utf8');
  renameSync(tmp, target);
}

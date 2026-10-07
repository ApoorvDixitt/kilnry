// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// F-102: a run manifest is written to a temporary file and renamed. The file
// was `run.kilnry.json.tmp`, which the Library watcher does not ignore, so each
// manifest write enqueued an import of a file that had already been renamed
// away. The temporary name must be one the watcher skips.

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { watcherIgnores } from '@kilnry/core';
import { manifestTempPath } from './workflows';

describe('the run manifest temporary file (F-LIB-04, F-102)', () => {
  it('is a name the Library watcher ignores, and the manifest itself is not', () => {
    const root = '/library';
    const target = join(root, 'Run_A', 'run.kilnry.json');
    expect(watcherIgnores(manifestTempPath(target), root)).toBe(true);
    expect(watcherIgnores(`${target}.tmp`, root)).toBe(false);
    expect(watcherIgnores(join(root, 'Run_A', 'final.mp4'), root)).toBe(false);
  });
});

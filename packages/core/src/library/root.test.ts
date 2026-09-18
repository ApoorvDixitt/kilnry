// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { KilnryError } from '../errors.js';
import { prepareLibraryRoot } from './root.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('prepareLibraryRoot', () => {
  it('creates the marker and required physical folders', () => {
    const base = mkdtempSync(join(tmpdir(), 'kilnry-library-'));
    roots.push(base);
    const dataDir = join(base, 'data');
    const library = join(base, 'library');
    mkdirSync(dataDir);

    const result = prepareLibraryRoot(library, dataDir);

    expect(result.root).toBe(realpathSync.native(library));
    expect(result.marker.library_id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(existsSync(join(library, 'inbox'))).toBe(true);
    expect(existsSync(join(library, 'Trash'))).toBe(true);
    expect(JSON.parse(readFileSync(join(library, '.kilnry', 'library.json'), 'utf8'))).toEqual(result.marker);
  });

  it('rejects a Library nested inside the private data directory', () => {
    const base = mkdtempSync(join(tmpdir(), 'kilnry-containment-'));
    roots.push(base);
    const dataDir = join(base, 'data');
    mkdirSync(dataDir);

    expect(() => prepareLibraryRoot(join(dataDir, 'media'), dataDir)).toThrowError(KilnryError);
  });
});

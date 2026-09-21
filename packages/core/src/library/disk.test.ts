// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { clearCache, diskStatus, mayDownload, directorySize } from './disk.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function dataDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'kilnry-disk-'));
  roots.push(root);
  mkdirSync(join(root, 'cache'), { recursive: true });
  return root;
}

describe('disk space (F-LIB-13)', () => {
  it('reports a real status with a level for the data volume', async () => {
    const status = await diskStatus(dataDir());
    expect(status.total_bytes).toBeGreaterThan(0);
    expect(['ok', 'warn', 'pause']).toContain(status.level);
  });

  it('pauses downloads only under one gigabyte free', () => {
    expect(mayDownload({ free_bytes: 2 * 1024 * 1024 * 1024 })).toBe(true);
    expect(mayDownload({ free_bytes: 512 * 1024 * 1024 })).toBe(false);
  });

  it('measures and then empties the cache, leaving the folder in place', async () => {
    const root = dataDir();
    writeFileSync(join(root, 'cache', 'thumb.webp'), 'x'.repeat(1024));
    mkdirSync(join(root, 'cache', 'previews'), { recursive: true });
    writeFileSync(join(root, 'cache', 'previews', 'p.webp'), 'y'.repeat(2048));
    expect(await directorySize(join(root, 'cache'))).toBe(1024 + 2048);
    const cleared = await clearCache(root);
    expect(cleared).toBe(1024 + 2048);
    expect(existsSync(join(root, 'cache'))).toBe(true);
    expect(readdirSync(join(root, 'cache'))).toHaveLength(0);
  });
});

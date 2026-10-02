// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Paths whose stat reports ENOENT, as if another job removed them after the
// directory listing.
const vanishing = new Set<string>();
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    stat: async (...args: Parameters<typeof actual.stat>) => {
      if (vanishing.has(String(args[0]))) {
        throw Object.assign(new Error(`ENOENT: no such file or directory, stat '${String(args[0])}'`), {
          code: 'ENOENT',
        });
      }
      return actual.stat(...args);
    },
  };
});

import { enforceCacheLimit } from './thumbnails.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('derivative cache limit', () => {
  it('removes least-recently-used files while retaining the newest complete item', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kilnry-cache-limit-'));
    roots.push(root);
    const cache = join(root, 'cache', 'thumbs');
    mkdirSync(cache, { recursive: true });
    const oldest = join(cache, 'old.webp');
    const middle = join(cache, 'middle.webp');
    const newest = join(cache, 'new.webp');
    for (const path of [oldest, middle, newest]) writeFileSync(path, Buffer.alloc(8));
    utimesSync(oldest, new Date(1_000), new Date(1_000));
    utimesSync(middle, new Date(2_000), new Date(2_000));
    utimesSync(newest, new Date(3_000), new Date(3_000));
    expect(await enforceCacheLimit(root, 10)).toEqual({ removed: 2, bytes: 8 });
    expect(existsSync(oldest)).toBe(false);
    expect(existsSync(middle)).toBe(false);
    expect(existsSync(newest)).toBe(true);
  });

  // This fails if a cache file removed between the listing and its stat — a
  // concurrent job's temporary sprite sheet — throws: that ENOENT crashed the
  // job that happened to run the cache check (M6 subtitles-burn transcribe).
  it('skips a file that disappears between the listing and its stat', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kilnry-cache-limit-'));
    roots.push(root);
    const cache = join(root, 'cache', 'sprites');
    mkdirSync(cache, { recursive: true });
    writeFileSync(join(cache, 'kept.webp'), Buffer.alloc(8));
    writeFileSync(join(cache, 'other.webp.png'), Buffer.alloc(8));
    vanishing.add(join(cache, 'other.webp.png'));
    expect(await enforceCacheLimit(root, 1024)).toEqual({ removed: 0, bytes: 8 });
    vanishing.clear();
  });
});

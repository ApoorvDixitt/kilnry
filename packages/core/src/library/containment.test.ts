// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveInRoot } from './containment.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Library path containment', () => {
  it('resolves a regular file and rejects traversal', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kilnry-containment-'));
    roots.push(root);
    mkdirSync(join(root, 'inbox'));
    writeFileSync(join(root, 'inbox', 'asset.png'), 'x');
    await expect(resolveInRoot(root, 'inbox/asset.png', { mustExist: true })).resolves.toMatchObject({
      rel: 'inbox/asset.png',
    });
    await expect(resolveInRoot(root, '../outside')).rejects.toThrow(/outside the Library/i);
  });

  it('rejects a symlink leaf and an ancestor escaping the root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kilnry-containment-'));
    const outside = mkdtempSync(join(tmpdir(), 'kilnry-outside-'));
    roots.push(root, outside);
    writeFileSync(join(outside, 'secret.txt'), 'not library data');
    symlinkSync(join(outside, 'secret.txt'), join(root, 'leaf'));
    symlinkSync(outside, join(root, 'ancestor'));
    await expect(resolveInRoot(root, 'leaf', { mustExist: true })).rejects.toThrow(/symbolic link/i);
    await expect(resolveInRoot(root, 'ancestor/secret.txt', { mustExist: true })).rejects.toThrow(
      /outside the Library/i,
    );
  });

  it('rejects reserved Windows names and alternate-data-stream syntax', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kilnry-containment-'));
    roots.push(root);
    await expect(resolveInRoot(root, 'CON/file.png', { platform: 'win32' })).rejects.toThrow(/Reserved/i);
    await expect(resolveInRoot(root, 'inbox/file.png:stream', { platform: 'win32' })).rejects.toThrow(
      /Windows/i,
    );
  });
});

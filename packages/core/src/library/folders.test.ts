// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createFolder,
  deleteFolderToTrash,
  folderNameError,
  listFolders,
  moveFolder,
  proposeFolderName,
  renameFolder,
} from './folders.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'kilnry-folders-'));
  roots.push(root);
  mkdirSync(join(root, 'inbox'));
  mkdirSync(join(root, '.kilnry'));
  return root;
}

describe('folderNameError', () => {
  it('accepts an ordinary name and rejects reserved, empty and dotted names', () => {
    expect(folderNameError('Campaign_A')).toBeNull();
    expect(folderNameError('')).toMatch(/needs a name/);
    expect(folderNameError('..')).toMatch(/only with dots/);
    expect(folderNameError('Trash')).toMatch(/reserved/);
    expect(folderNameError('a/b')).toMatch(/slash/);
    expect(folderNameError('name.')).toMatch(/space or a dot/);
  });

  it('rejects Windows-forbidden characters on win32', () => {
    expect(folderNameError('Campaign:A', 'win32')).toMatch(/Windows/);
    expect(folderNameError('Campaign:A', 'linux')).toBeNull();
  });
});

describe('proposeFolderName', () => {
  it('replaces forbidden characters with underscores', () => {
    expect(proposeFolderName('Campaign:A')).toBe('Campaign_A');
    expect(proposeFolderName('a/b*c')).toBe('a_b_c');
  });
});

describe('folder operations', () => {
  it('lists real folders with inbox first and Trash last, hiding Kilnry folders', async () => {
    const root = makeRoot();
    mkdirSync(join(root, 'Campaign_A'));
    mkdirSync(join(root, 'Aardvark'));
    const nodes = await listFolders(root);
    expect(nodes[0]).toMatchObject({ name: 'inbox', pinned: 'inbox' });
    expect(nodes.at(-1)).toMatchObject({ name: 'Trash', pinned: 'trash' });
    const middle = nodes.slice(1, -1).map((n) => n.name);
    expect(middle).toEqual(['Aardvark', 'Campaign_A']);
    expect(middle).not.toContain('.kilnry');
  });

  it('creates, renames and moves a folder on disk', async () => {
    const root = makeRoot();
    await createFolder(root, '', 'Drafts');
    expect(existsSync(join(root, 'Drafts'))).toBe(true);
    await renameFolder(root, 'Drafts', 'Final');
    expect(existsSync(join(root, 'Final'))).toBe(true);
    await createFolder(root, '', 'Campaign_A');
    await moveFolder(root, 'Final', 'Campaign_A');
    expect(existsSync(join(root, 'Campaign_A', 'Final'))).toBe(true);
    expect(existsSync(join(root, 'Final'))).toBe(false);
  });

  it('rejects a duplicate name and an invalid name', async () => {
    const root = makeRoot();
    await createFolder(root, '', 'Dupe');
    await expect(createFolder(root, '', 'Dupe')).rejects.toThrow(/already exists/);
    await expect(createFolder(root, '', 'Trash')).rejects.toThrow(/reserved/);
  });

  it('refuses to move a folder inside itself', async () => {
    const root = makeRoot();
    await createFolder(root, '', 'Parent');
    await createFolder(root, 'Parent', 'Child');
    await expect(moveFolder(root, 'Parent', 'Parent/Child')).rejects.toThrow(/inside itself/);
  });

  it('deletes a folder into Trash with a timestamped name', async () => {
    const root = makeRoot();
    await createFolder(root, '', 'Old');
    const target = await deleteFolderToTrash(root, 'Old');
    expect(existsSync(join(root, 'Old'))).toBe(false);
    expect(target).toMatch(/Trash\/Old__/);
    expect(existsSync(target)).toBe(true);
  });

  it('rejects traversal outside the root', async () => {
    const root = makeRoot();
    await expect(renameFolder(root, '../escape', 'x')).rejects.toThrow(/outside the Library/i);
  });
});

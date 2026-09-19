// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { mkdir, readdir, rename, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { KilnryError } from '../errors.js';
import { resolveInRoot } from './containment.js';

export interface FolderNode {
  name: string;
  path: string; // path relative to the Library root, using forward slashes
  pinned?: 'inbox' | 'trash';
}

const HIDDEN = new Set(['.kilnry', 'Trash']);
const WINDOWS_FORBIDDEN = /[<>:"/\\|?*]/g;

// Propose a host-safe replacement for a folder name the operating system would
// reject, so the interface can offer "Use 'Campaign_A'?".
export function proposeFolderName(name: string): string {
  return (
    name
      .replace(WINDOWS_FORBIDDEN, '_')
      .replace(/[. ]+$/, '')
      .trim() || 'folder'
  );
}

// A folder name is acceptable when it is non-empty, is not a reserved or hidden
// name, and contains no character the host operating system forbids.
export function folderNameError(name: string, platform: NodeJS.Platform = process.platform): string | null {
  if (!name || name.trim() === '') return 'A folder needs a name.';
  if (name.includes('/') || name.includes('\0')) return 'A folder name cannot contain a slash.';
  if (/^\.+$/.test(name)) return 'A folder cannot be named only with dots.';
  if (/[. ]$/.test(name)) return 'A folder name cannot end with a space or a dot.';
  if (HIDDEN.has(name)) return `"${name}" is reserved by Kilnry.`;
  if (platform === 'win32' && WINDOWS_FORBIDDEN.test(name)) {
    return `Windows does not allow a folder named "${name}".`;
  }
  return null;
}

// List the real directories directly under the Library root, alphabetically,
// with inbox pinned first and Trash pinned last, hiding Kilnry's own folders.
export async function listFolders(root: string): Promise<FolderNode[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !HIDDEN.has(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  const nodes: FolderNode[] = [{ name: 'inbox', path: 'inbox', pinned: 'inbox' }];
  for (const name of dirs) {
    if (name === 'inbox') continue;
    nodes.push({ name, path: name });
  }
  nodes.push({ name: 'Trash', path: 'Trash', pinned: 'trash' });
  return nodes;
}

export async function createFolder(root: string, parentRel: string, name: string): Promise<string> {
  const error = folderNameError(name);
  if (error) throw new KilnryError('INVALID_INPUT', error);
  const parent = parentRel ? await resolveInRoot(root, parentRel, { mustExist: true }) : { abs: root };
  const target = join(parent.abs, name);
  if (await pathExists(target))
    throw new KilnryError('INVALID_INPUT', `A folder called '${name}' already exists here.`);
  await mkdir(target, { recursive: false });
  return target;
}

export async function renameFolder(root: string, folderRel: string, nextName: string): Promise<string> {
  const error = folderNameError(nextName);
  if (error) throw new KilnryError('INVALID_INPUT', error);
  const source = await resolveInRoot(root, folderRel, { mustExist: true });
  const target = join(dirname(source.abs), nextName);
  if (await pathExists(target)) {
    throw new KilnryError('INVALID_INPUT', `A folder called '${nextName}' already exists here.`);
  }
  await rename(source.abs, target);
  return target;
}

export async function moveFolder(root: string, folderRel: string, destParentRel: string): Promise<string> {
  const source = await resolveInRoot(root, folderRel, { mustExist: true });
  const destParent = destParentRel
    ? await resolveInRoot(root, destParentRel, { mustExist: true })
    : { abs: root };
  const name = basename(source.abs);
  if (destParent.abs === source.abs || destParent.abs.startsWith(`${source.abs}/`)) {
    throw new KilnryError('INVALID_INPUT', 'A folder cannot be moved inside itself.');
  }
  const target = join(destParent.abs, name);
  if (await pathExists(target)) {
    throw new KilnryError('INVALID_INPUT', `A folder called '${name}' already exists there.`);
  }
  await rename(source.abs, target);
  return target;
}

// Deleting a folder moves it under Trash/<name>__<timestamp>/ rather than
// removing it, so nothing is lost and a Restore is possible.
export async function deleteFolderToTrash(root: string, folderRel: string): Promise<string> {
  const source = await resolveInRoot(root, folderRel, { mustExist: true });
  const name = basename(source.abs);
  const trashRoot = join(root, 'Trash');
  await mkdir(trashRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = join(trashRoot, `${name}__${stamp}`);
  await rename(source.abs, target);
  return target;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

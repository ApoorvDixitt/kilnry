// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { KilnryError } from '../errors.js';

const windowsReserved = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i;

export interface ResolveOptions {
  mustExist?: boolean;
  allowSymlink?: boolean;
  platform?: NodeJS.Platform;
}

function validateSegments(path: string, platform: NodeJS.Platform): void {
  if (Buffer.byteLength(path) > 900)
    throw new KilnryError('INVALID_INPUT', 'Library path is longer than 900 bytes.');
  for (const segment of path.split('/')) {
    if (!segment || /^\.+$/.test(segment) || segment.includes('\0')) {
      throw new KilnryError('INVALID_INPUT', `Invalid Library path segment: ${segment || '(empty)'}.`);
    }
    if (Buffer.byteLength(segment) > 200)
      throw new KilnryError('INVALID_INPUT', `Library path segment is longer than 200 bytes: ${segment}.`);
    if (
      segment === '.kilnry' ||
      segment === 'Trash' ||
      windowsReserved.test(segment) ||
      /[. ]$/.test(segment)
    ) {
      throw new KilnryError('INVALID_INPUT', `Reserved Library path segment: ${segment}.`);
    }
    if (platform === 'win32' && (segment.includes(':') || /[<>"|?*]/.test(segment))) {
      throw new KilnryError('INVALID_INPUT', `Windows does not allow this folder name: ${segment}.`);
    }
  }
}

export async function resolveInRoot(
  root: string,
  input: string,
  options: ResolveOptions = {},
): Promise<{ abs: string; rel: string; rootReal: string }> {
  const rootAbsolute = resolve(root);
  const rootReal = await realpath(root);
  const inputAbsolute = isAbsolute(input) ? resolve(input) : resolve(rootAbsolute, input);
  const lexicalFromOriginalRoot = relative(rootAbsolute, inputAbsolute);
  const lexicallyInsideOriginalRoot =
    lexicalFromOriginalRoot !== '' &&
    !lexicalFromOriginalRoot.startsWith('..') &&
    !isAbsolute(lexicalFromOriginalRoot);
  const candidate = lexicallyInsideOriginalRoot ? resolve(rootReal, lexicalFromOriginalRoot) : inputAbsolute;
  const rawRelative = relative(rootReal, candidate);
  const compare = options.platform === 'win32' ? rawRelative.toLowerCase() : rawRelative;
  if (!rawRelative || compare.startsWith('..') || isAbsolute(rawRelative)) {
    throw new KilnryError('INVALID_INPUT', 'That path is outside the Library.');
  }
  const rel = rawRelative.split(sep).join('/');
  validateSegments(rel, options.platform ?? process.platform);
  const parts = rawRelative.split(sep);
  let current = rootReal;
  for (let index = 0; index < parts.length; index += 1) {
    current = resolve(current, parts[index]!);
    try {
      const stats = await lstat(current);
      if (!stats.isSymbolicLink()) continue;
      if (index === parts.length - 1 && !options.allowSymlink) {
        throw new KilnryError('INVALID_INPUT', 'A Library asset cannot be a symbolic link.');
      }
      const target = await realpath(current);
      const targetRelative = relative(rootReal, target);
      if (targetRelative.startsWith('..') || isAbsolute(targetRelative)) {
        throw new KilnryError('INVALID_INPUT', 'That symbolic link resolves outside the Library.');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        if (options.mustExist)
          throw new KilnryError('NOT_FOUND', `Library path not found: ${rel}.`, { cause: error });
        break;
      }
      throw error;
    }
  }
  return { abs: candidate, rel, rootReal };
}

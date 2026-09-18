// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { KilnryError } from '../errors.js';
import { ulid } from '../ids.js';

export interface LibraryMarker {
  library_id: string;
  created_at: string;
  schema_version: 1;
}

function expandHome(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return path;
}

function isInside(parent: string, candidate: string): boolean {
  const path = relative(parent, candidate);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

export function prepareLibraryRoot(input: string, dataDir: string): { root: string; marker: LibraryMarker } {
  if (!input.trim()) throw new KilnryError('INVALID_INPUT', 'Choose a Library folder.');
  const requested = resolve(expandHome(input.trim()));
  const data = realpathSync.native(dataDir);
  if (isInside(data, requested)) {
    throw new KilnryError(
      'INVALID_INPUT',
      "The Library can't live inside Kilnry's data folder. Pick another folder.",
    );
  }

  mkdirSync(requested, { recursive: true, mode: 0o700 });
  const root = realpathSync.native(requested);
  if (isInside(data, root)) {
    throw new KilnryError(
      'INVALID_INPUT',
      "The Library can't live inside Kilnry's data folder. Pick another folder.",
    );
  }

  try {
    accessSync(root, constants.R_OK | constants.W_OK);
    const probe = join(root, `.kilnry-write-${process.pid}`);
    writeFileSync(probe, 'ok', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    rmSync(probe);
  } catch (error) {
    throw new KilnryError(
      'INVALID_INPUT',
      "Kilnry can't write here. Pick another folder or fix permissions.",
      {
        cause: error,
      },
    );
  }

  const metadataDir = join(root, '.kilnry');
  const markerPath = join(metadataDir, 'library.json');
  mkdirSync(metadataDir, { recursive: true, mode: 0o700 });
  mkdirSync(join(root, 'inbox'), { recursive: true, mode: 0o700 });
  mkdirSync(join(root, 'Trash'), { recursive: true, mode: 0o700 });

  let marker: LibraryMarker;
  if (existsSync(markerPath)) {
    const value = JSON.parse(readFileSync(markerPath, 'utf8')) as LibraryMarker;
    if (value.schema_version !== 1 || typeof value.library_id !== 'string') {
      throw new KilnryError(
        'INVALID_INPUT',
        'This Library marker is not supported by this version of Kilnry.',
      );
    }
    marker = value;
  } else {
    marker = { library_id: ulid(), created_at: new Date().toISOString(), schema_version: 1 };
    writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  }
  return { root, marker };
}

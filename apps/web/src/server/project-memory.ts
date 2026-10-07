// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Project memory (F-CHT-09, TRD-11 §7). Each Chat session belongs to a Project
// folder, and the agent reads that folder's notes — brand facts, style rules,
// the default character — at the start of every turn so they shape the run. The
// notes live in a plain Markdown file the user can edit in any editor, at
// <Library>/<folder>/.kilnry/project.md (the .kilnry sidecar folder is the only
// config allowed inside the Library, D-03). The file is the source of truth; the
// body below the optional YAML front matter is injected verbatim as the fifth
// instructions block, capped at four kilobytes.

import { existsSync } from 'node:fs';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { resolveInRoot } from '@kilnry/core';

const MEMORY_MAX_BYTES = 4 * 1024;
const TRUNCATION_NOTE = '\n\n[…memory truncated at 4 KB; open the file to edit]';

/**
 * The project.md path for a folder, contained inside the Library root. The
 * folder resolves through resolveInRoot, as every other Library path does
 * (TRD-15 §10), so a folder that is a symbolic link, or that leads out of the
 * root through one, is refused; the containment used to be a string prefix
 * check that followed a symlinked folder out of the Library (F-108). The
 * `.kilnry` folder and the file itself must not be links either.
 */
async function projectMemoryPath(libraryRoot: string, folder: string): Promise<string | undefined> {
  if (libraryRoot === '' || folder === '') return undefined;
  let folderPath: string;
  try {
    folderPath = (await resolveInRoot(libraryRoot, folder)).abs;
  } catch {
    return undefined;
  }
  const sidecar = join(folderPath, '.kilnry');
  const target = join(sidecar, 'project.md');
  for (const path of [sidecar, target]) {
    try {
      if ((await lstat(path)).isSymbolicLink()) return undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
      return undefined;
    }
  }
  return target;
}

/** Read the full project.md text for a folder, or an empty string when absent. */
export async function readProjectMemory(libraryRoot: string, folder: string): Promise<string> {
  const path = await projectMemoryPath(libraryRoot, folder);
  if (!path || !existsSync(path)) return '';
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

/** The body below the front matter, capped at four kilobytes for the prompt. */
export async function projectMemoryBody(libraryRoot: string, folder: string): Promise<string> {
  const text = await readProjectMemory(libraryRoot, folder);
  if (text === '') return '';
  const body = text.replace(/^---[\s\S]*?\n---\n?/, '').trim();
  const encoder = new TextEncoder();
  if (encoder.encode(body).byteLength <= MEMORY_MAX_BYTES) return body;
  // Truncate on a byte boundary, then note that it was cut.
  let end = MEMORY_MAX_BYTES;
  while (end > 0 && encoder.encode(body.slice(0, end)).byteLength > MEMORY_MAX_BYTES) end -= 1;
  return body.slice(0, end).trimEnd() + TRUNCATION_NOTE;
}

/** Write the project.md for a folder, creating the .kilnry sidecar if needed. */
export async function writeProjectMemory(
  libraryRoot: string,
  folder: string,
  text: string,
): Promise<boolean> {
  const path = await projectMemoryPath(libraryRoot, folder);
  if (!path) return false;
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text, 'utf8');
    return true;
  } catch {
    return false;
  }
}

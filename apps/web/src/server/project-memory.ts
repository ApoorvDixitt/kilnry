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

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MEMORY_MAX_BYTES = 4 * 1024;
const TRUNCATION_NOTE = '\n\n[…memory truncated at 4 KB; open the file to edit]';

/** The project.md path for a folder, contained inside the Library root. */
function projectMemoryPath(libraryRoot: string, folder: string): string | undefined {
  if (libraryRoot === '' || folder === '') return undefined;
  const base = resolve(libraryRoot);
  const target = resolve(base, folder, '.kilnry', 'project.md');
  // Contain the path to the Library: reject a folder that escapes it.
  if (target !== base && !target.startsWith(`${base}/`)) return undefined;
  return target;
}

/** Read the full project.md text for a folder, or an empty string when absent. */
export function readProjectMemory(libraryRoot: string, folder: string): string {
  const path = projectMemoryPath(libraryRoot, folder);
  if (!path || !existsSync(path)) return '';
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

/** The body below the front matter, capped at four kilobytes for the prompt. */
export function projectMemoryBody(libraryRoot: string, folder: string): string {
  const text = readProjectMemory(libraryRoot, folder);
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
export function writeProjectMemory(libraryRoot: string, folder: string, text: string): boolean {
  const path = projectMemoryPath(libraryRoot, folder);
  if (!path) return false;
  try {
    mkdirSync(join(resolve(libraryRoot), folder, '.kilnry'), { recursive: true });
    writeFileSync(path, text, 'utf8');
    return true;
  } catch {
    return false;
  }
}

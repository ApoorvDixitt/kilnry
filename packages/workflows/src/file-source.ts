// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The `file(path[#EXPORT])` template function (TRD-12 §3). A workflow may inline
// a bundled prompt so the wording lives in a reviewable source file rather than
// wrapped inside YAML. It reads either a plain text file or one named export of a
// TypeScript prompt module.
//
// Security (TRD-12 §11): module code is never executed. A `#EXPORT` reference is
// resolved by parsing the module text for an exported string constant — a
// template literal or a quoted string — and refusing anything else. Paths are
// confined to `packages/**` and the workflow's own folder, and no single file
// larger than 32 KB is read. A path outside the allowed roots, a missing file, a
// missing or non-string export, or an oversized file each raises a clear error
// the validator surfaces before a run starts.

import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

/** The maximum size of a file `file()` will read, in bytes (TRD-12 §3). */
export const FILE_SOURCE_MAX_BYTES = 32 * 1024;

/** Raised when a `file()` reference is disallowed or cannot be resolved. */
export class FileSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileSourceError';
  }
}

/**
 * Where `file()` may read from. `packagesRoot` is the repository's `packages`
 * directory; `workflowDir` is the folder the workflow file itself lives in, if
 * known. A reference is allowed only when its resolved absolute path stays inside
 * one of these roots.
 */
export interface FileSourceRoots {
  packagesRoot: string;
  workflowDir?: string;
}

function within(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

// Resolve a reference path against the allowed roots and return the absolute
// path, or throw if it escapes them. A `packages/...`-rooted path is resolved
// against the parent of `packagesRoot`; any other path is resolved against the
// workflow's own folder.
function resolvePath(ref: string, roots: FileSourceRoots): string {
  if (ref.includes('\0')) throw new FileSourceError(`file() path "${ref}" is not allowed`);
  const normalisedRef = ref.split('/').join(sep);
  const packagesParent = resolve(roots.packagesRoot, '..');
  const candidates: string[] = [];
  if (ref.startsWith('packages/') || ref.startsWith(`packages${sep}`)) {
    candidates.push(resolve(packagesParent, normalisedRef));
  } else if (roots.workflowDir !== undefined) {
    candidates.push(resolve(roots.workflowDir, normalisedRef));
  }
  for (const candidate of candidates) {
    const insidePackages = within(roots.packagesRoot, candidate);
    const insideWorkflow = roots.workflowDir !== undefined && within(roots.workflowDir, candidate);
    if (insidePackages || insideWorkflow) return candidate;
  }
  throw new FileSourceError(
    `file() path "${ref}" is outside the allowed roots (packages/** or the workflow's folder)`,
  );
}

function readCapped(absolute: string, ref: string): string {
  let size: number;
  try {
    size = statSync(absolute).size;
  } catch {
    throw new FileSourceError(`file() cannot read "${ref}": no such file`);
  }
  if (size > FILE_SOURCE_MAX_BYTES) {
    throw new FileSourceError(
      `file() will not read "${ref}": ${size} bytes exceeds the ${FILE_SOURCE_MAX_BYTES}-byte cap`,
    );
  }
  return readFileSync(absolute, 'utf8');
}

// Find `export const <NAME> = <string | template literal>` in module text and
// return the literal's contents, without evaluating the module. A `.join(...)`
// chain on an array of strings is folded, because the shipped prompt modules
// build a paragraph that way. Anything else — a computed value, a function call
// other than that join, a non-string constant — is refused.
function extractExport(source: string, name: string, ref: string): string {
  const declaration = new RegExp(`export\\s+const\\s+${name}\\s*(?::[^=]+)?=\\s*`);
  const match = declaration.exec(source);
  if (!match) {
    throw new FileSourceError(`file() export "${name}" not found in "${ref}"`);
  }
  const rest = source.slice(match.index + match[0].length);
  const first = rest[0];

  // A single quoted string or template literal.
  if (first === '`' || first === '"' || first === "'") {
    const literal = readLiteral(rest, first, name, ref);
    return literal.value;
  }

  // An array of string literals joined into one paragraph: `[ 'a', 'b' ].join(' ')`.
  if (first === '[') {
    return foldJoinedArray(rest, name, ref);
  }

  throw new FileSourceError(`file() export "${name}" in "${ref}" is not a string constant`);
}

// Read one string or template-literal token starting at index 0 of `text`.
// Template literals must not contain a `${...}` substitution, since evaluating
// one would run code; a substitution is refused.
function readLiteral(text: string, quote: string, name: string, ref: string): { value: string; end: number } {
  let out = '';
  for (let i = 1; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\\') {
      const next = text[i + 1] ?? '';
      out += unescape(next);
      i += 1;
      continue;
    }
    if (quote === '`' && ch === '$' && text[i + 1] === '{') {
      throw new FileSourceError(
        `file() export "${name}" in "${ref}" interpolates a value; only a plain string constant is allowed`,
      );
    }
    if (ch === quote) return { value: out, end: i };
    out += ch;
  }
  throw new FileSourceError(`file() export "${name}" in "${ref}" has an unterminated string`);
}

function unescape(next: string): string {
  switch (next) {
    case 'n':
      return '\n';
    case 't':
      return '\t';
    case 'r':
      return '\r';
    case '`':
      return '`';
    case '"':
      return '"';
    case "'":
      return "'";
    case '\\':
      return '\\';
    case '\n':
      return '';
    default:
      return next;
  }
}

// Parse `[ <string>, <string>, ... ].join(<string>)` and return the joined text.
function foldJoinedArray(text: string, name: string, ref: string): string {
  const parts: string[] = [];
  let i = 1; // past '['
  for (;;) {
    while (i < text.length && /[\s,]/.test(text[i] ?? '')) i += 1;
    const ch = text[i];
    if (ch === ']') {
      i += 1;
      break;
    }
    if (ch === '`' || ch === '"' || ch === "'") {
      const literal = readLiteral(text.slice(i), ch, name, ref);
      parts.push(literal.value);
      i += literal.end + 1;
      continue;
    }
    throw new FileSourceError(`file() export "${name}" in "${ref}" is not an array of string constants`);
  }
  // Optional `.join(<sep>)`.
  const after = text.slice(i);
  const joinMatch = /^\s*\.join\(\s*(['"`])([\s\S]*?)\1\s*\)/.exec(after);
  const separator = joinMatch ? (joinMatch[2] ?? '') : '';
  return parts.join(separator);
}

/**
 * Read a `file()` reference. `ref` is `path` or `path#EXPORT`. With an export,
 * the module text is parsed for that exported string constant; without one, the
 * whole file's text is returned. The read is confined to `roots` and capped.
 */
export function readFileSource(ref: string, roots: FileSourceRoots): string {
  const hash = ref.indexOf('#');
  const path = hash === -1 ? ref : ref.slice(0, hash);
  const exportName = hash === -1 ? undefined : ref.slice(hash + 1);
  if (path === '') throw new FileSourceError('file() needs a path');
  const absolute = resolvePath(path, roots);
  const text = readCapped(absolute, ref);
  if (exportName === undefined) return text;
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(exportName)) {
    throw new FileSourceError(`file() export name "${exportName}" is not a valid identifier`);
  }
  return extractExport(text, exportName, ref);
}

/**
 * The directory that holds the shipped packages, found by walking up from a
 * starting directory to a folder literally named `packages` (the repository
 * layout is `<repo>/packages/<name>/...`). Falls back to `<start>/packages` when
 * none is found, so a workflow outside the tree resolves `packages/...` against
 * its own neighbourhood rather than silently reading elsewhere.
 */
export function packagesRootFrom(startDir: string): string {
  let dir = resolve(startDir);
  for (;;) {
    if (dir.endsWith(`${sep}packages`) || dir.endsWith(`${sep}packages${sep}`)) return dir;
    const parent = resolve(dir, '..');
    // A `packages` child of the current directory (walking up from a catalogue
    // folder we may pass through `packages/workflows/catalogue`).
    const child = join(dir, 'packages');
    try {
      if (statSync(child).isDirectory()) return child;
    } catch {
      // no packages child here; keep walking up
    }
    if (parent === dir) return join(resolve(startDir), 'packages');
    dir = parent;
  }
}

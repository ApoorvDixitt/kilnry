// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// AGENTS.md:84: where canon is silent, choose the simplest option, "mark it
// `(default; adjustable)` in code and in `docs/STATUS.md`". F-04 found the two
// sides out of step: markers in code with no STATUS line, STATUS defaults no
// code line owned. docs/STATUS.md's "Defaults index" is the join; this test
// fails on a one-sided marker in either direction.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const MARKER = /default; adjustable/;
const status = readFileSync(join(root, 'docs', 'STATUS.md'), 'utf8');

function indexSection(): string {
  const start = status.indexOf('\n## Defaults index');
  if (start === -1) return '';
  const end = status.indexOf('\n## ', start + 1);
  return status.slice(start, end === -1 ? undefined : end);
}

// Rows: | default | `path` or — | origin |
function indexedPaths(): Set<string> {
  const paths = new Set<string>();
  for (const line of indexSection().split('\n')) {
    if (!line.startsWith('| ') || line.startsWith('| Default') || line.startsWith('|---')) continue;
    for (const match of line.matchAll(/`([^`]+\.(?:ts|tsx|mts|yaml))`/g)) paths.add(match[1]!);
  }
  return paths;
}

// Source files that carry the marker. Test files restate the default they
// test; the owning line is in the implementation, so tests are not owners.
function markedFiles(): string[] {
  const listed = execFileSync(
    'git',
    ['ls-files', 'packages', 'apps/web/src', 'scripts', 'e2e', 'pnpm-workspace.yaml'],
    {
      cwd: root,
      encoding: 'utf8',
    },
  )
    .split('\n')
    .filter(
      (path) => /\.(?:ts|tsx|mts|yaml)$/.test(path) && !/\.(?:test|spec)\.|\.browser\.test\./.test(path),
    )
    .filter((path) => path !== 'scripts/defaults-index.test.ts');
  return listed.filter(
    (path) => existsSync(join(root, path)) && MARKER.test(readFileSync(join(root, path), 'utf8')),
  );
}

describe('(default; adjustable) markers match docs/STATUS.md (F-04)', () => {
  it('STATUS has a Defaults index', () => {
    expect(indexSection(), 'docs/STATUS.md has no "## Defaults index" section').not.toBe('');
  });

  it('every file that marks a default in code is named in the index', () => {
    const indexed = indexedPaths();
    expect(markedFiles().filter((path) => !indexed.has(path))).toEqual([]);
  });

  it('every file the index names exists and carries the marker', () => {
    const missing = [...indexedPaths()].filter(
      (path) => !existsSync(join(root, path)) || !MARKER.test(readFileSync(join(root, path), 'utf8')),
    );
    expect(missing).toEqual([]);
  });

  it('every STATUS line outside the index that states a default points at the index', () => {
    const index = indexSection();
    const outside = status.replace(index, '');
    const unindexed = outside
      .split('\n')
      .filter((line) => /default[;,]? \(?adjustable|default \(adjustable\)/i.test(line))
      .filter((line) => !line.includes('Defaults index'));
    expect(unindexed).toEqual([]);
  });
});

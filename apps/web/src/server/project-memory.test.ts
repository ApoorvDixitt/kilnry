// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Project memory (F-CHT-09, TRD-11 §7). These cases prove the folder's
// project.md round-trips, its body is injected below the front matter and capped
// at four kilobytes, and a folder that escapes the Library is refused.

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectMemoryBody, readProjectMemory, writeProjectMemory } from './project-memory';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function libraryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'kilnry-memory-'));
  roots.push(root);
  return root;
}

const MEMORY = `---
project: Chai Diaries
default_character: "@maya"
---
# Notes
Warm morning light. Hindi hook, English payoff.
`;

describe('project memory (F-CHT-09)', () => {
  it('writes and reads a folder project.md', () => {
    const library = libraryRoot();
    expect(writeProjectMemory(library, 'Client_A', MEMORY)).toBe(true);
    expect(readProjectMemory(library, 'Client_A')).toContain('Warm morning light');
    expect(readFileSync(join(library, 'Client_A', '.kilnry', 'project.md'), 'utf8')).toContain(
      'project: Chai Diaries',
    );
  });

  it('injects only the body below the front matter', () => {
    const library = libraryRoot();
    writeProjectMemory(library, 'Client_A', MEMORY);
    const body = projectMemoryBody(library, 'Client_A');
    expect(body).toContain('# Notes');
    expect(body).not.toContain('project: Chai Diaries');
  });

  it('caps the injected body at four kilobytes', () => {
    const library = libraryRoot();
    writeProjectMemory(library, 'Client_A', `# Notes\n${'x'.repeat(8 * 1024)}`);
    const body = projectMemoryBody(library, 'Client_A');
    expect(new TextEncoder().encode(body).byteLength).toBeLessThanOrEqual(4 * 1024 + 80);
    expect(body).toContain('memory truncated at 4 KB');
  });

  it('returns an empty body when the folder has no memory', () => {
    const library = libraryRoot();
    expect(projectMemoryBody(library, 'Empty')).toBe('');
  });

  it('refuses a folder that escapes the Library root', () => {
    const library = libraryRoot();
    expect(writeProjectMemory(library, '../../etc', MEMORY)).toBe(false);
    expect(readProjectMemory(library, '../../etc')).toBe('');
  });
});

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Project memory (F-CHT-09, TRD-11 §7). These cases prove the folder's
// project.md round-trips, its body is injected below the front matter and capped
// at four kilobytes, and a folder that escapes the Library is refused.

import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
  it('writes and reads a folder project.md', async () => {
    const library = libraryRoot();
    expect(await writeProjectMemory(library, 'Client_A', MEMORY)).toBe(true);
    expect(await readProjectMemory(library, 'Client_A')).toContain('Warm morning light');
    expect(readFileSync(join(library, 'Client_A', '.kilnry', 'project.md'), 'utf8')).toContain(
      'project: Chai Diaries',
    );
  });

  it('injects only the body below the front matter', async () => {
    const library = libraryRoot();
    await writeProjectMemory(library, 'Client_A', MEMORY);
    const body = await projectMemoryBody(library, 'Client_A');
    expect(body).toContain('# Notes');
    expect(body).not.toContain('project: Chai Diaries');
  });

  it('caps the injected body at four kilobytes', async () => {
    const library = libraryRoot();
    await writeProjectMemory(library, 'Client_A', `# Notes\n${'x'.repeat(8 * 1024)}`);
    const body = await projectMemoryBody(library, 'Client_A');
    expect(new TextEncoder().encode(body).byteLength).toBeLessThanOrEqual(4 * 1024 + 80);
    expect(body).toContain('memory truncated at 4 KB');
  });

  it('returns an empty body when the folder has no memory', async () => {
    const library = libraryRoot();
    expect(await projectMemoryBody(library, 'Empty')).toBe('');
  });

  it('refuses a folder that escapes the Library root', async () => {
    const library = libraryRoot();
    expect(await writeProjectMemory(library, '../../etc', MEMORY)).toBe(false);
    expect(await readProjectMemory(library, '../../etc')).toBe('');
  });
});

// F-108: the containment was a string prefix check, so a folder that is a
// symbolic link to a directory outside the Library was followed and its
// project.md read into the system prompt (the audit's H-12 script).
describe('project memory refuses a symlinked folder (F-108)', () => {
  it('reads nothing and writes nothing through a link out of the Library', async () => {
    const library = libraryRoot();
    const outside = libraryRoot();
    mkdirSync(join(outside, '.kilnry'), { recursive: true });
    writeFileSync(join(outside, '.kilnry', 'project.md'), '# SECRET OUTSIDE MEMORY\n');
    symlinkSync(outside, join(library, 'client'));
    expect(await readProjectMemory(library, 'client')).toBe('');
    expect(await projectMemoryBody(library, 'client')).toBe('');
    expect(await writeProjectMemory(library, 'client', 'overwrite')).toBe(false);
    expect(readFileSync(join(outside, '.kilnry', 'project.md'), 'utf8')).toBe('# SECRET OUTSIDE MEMORY\n');
  });
});

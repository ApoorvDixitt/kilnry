// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FILE_SOURCE_MAX_BYTES,
  FileSourceError,
  readFileSource,
  type FileSourceRoots,
} from './file-source.js';
import { evaluateExpression, TemplateError, withFileSource } from './template.js';

describe('file() source reader (TRD-12 §3)', () => {
  let root: string;
  let packagesRoot: string;
  let workflowDir: string;
  let roots: FileSourceRoots;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'kilnry-file-source-'));
    packagesRoot = join(root, 'packages');
    workflowDir = join(packagesRoot, 'workflows', 'catalogue');
    mkdirSync(join(packagesRoot, 'core'), { recursive: true });
    mkdirSync(workflowDir, { recursive: true });
    roots = { packagesRoot, workflowDir };

    writeFileSync(join(packagesRoot, 'core', 'notes.md'), 'A bundled prompt.\nSecond line.');
    writeFileSync(join(workflowDir, 'local.txt'), 'A prompt beside the workflow.');
    writeFileSync(
      join(packagesRoot, 'core', 'prompts.ts'),
      [
        "export const QUOTED = 'a single quoted prompt';",
        'export const TEMPLATE = `a template literal prompt`;',
        "export const JOINED = ['first line.', 'second line.'].join(' ');",
        'export const NUMBER = 42;',
        'export const INTERP = `hello ${name}`;',
      ].join('\n'),
    );
    writeFileSync(join(packagesRoot, 'core', 'big.md'), 'x'.repeat(FILE_SOURCE_MAX_BYTES + 1));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reads a bundled text file whole', () => {
    expect(readFileSource('packages/core/notes.md', roots)).toBe('A bundled prompt.\nSecond line.');
  });

  it('reads a text file beside the workflow', () => {
    expect(readFileSource('local.txt', roots)).toBe('A prompt beside the workflow.');
  });

  it('reads a named export: quoted, template literal and joined array', () => {
    expect(readFileSource('packages/core/prompts.ts#QUOTED', roots)).toBe('a single quoted prompt');
    expect(readFileSource('packages/core/prompts.ts#TEMPLATE', roots)).toBe('a template literal prompt');
    expect(readFileSource('packages/core/prompts.ts#JOINED', roots)).toBe('first line. second line.');
  });

  it('refuses a non-string export and an interpolating template literal', () => {
    expect(() => readFileSource('packages/core/prompts.ts#NUMBER', roots)).toThrow(FileSourceError);
    expect(() => readFileSource('packages/core/prompts.ts#INTERP', roots)).toThrow(/interpolates/);
  });

  it('refuses a missing export', () => {
    expect(() => readFileSource('packages/core/prompts.ts#NOPE', roots)).toThrow(/not found/);
  });

  it('refuses a path outside the allowed roots', () => {
    expect(() => readFileSource('../../etc/passwd', roots)).toThrow(FileSourceError);
    expect(() => readFileSource('packages/../../../secret', roots)).toThrow(FileSourceError);
  });

  it('refuses a file over the 32 KB cap', () => {
    expect(() => readFileSource('packages/core/big.md', roots)).toThrow(/exceeds/);
  });

  it('is callable from a template only when roots are installed', () => {
    const scope = withFileSource({}, roots);
    expect(evaluateExpression("file('packages/core/notes.md')", scope)).toBe(
      'A bundled prompt.\nSecond line.',
    );
    // Without roots, file() refuses rather than reading by surprise.
    expect(() => evaluateExpression("file('packages/core/notes.md')", {})).toThrow(TemplateError);
  });

  it('pipes a read export into render()', () => {
    const scope = withFileSource({}, roots);
    expect(evaluateExpression("file('packages/core/prompts.ts#TEMPLATE')", scope)).toBe(
      'a template literal prompt',
    );
  });
});

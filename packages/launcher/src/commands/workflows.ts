// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// `kilnry workflows validate <file...>` (F-WFL-06, TRD-12 §7). Validates one or
// more workflow YAML files against the schema and the cross-reference and
// security rules, printing each file's issues. It runs standalone — it does not
// open the database or contact the server — so it can be used in a pre-commit
// check or over the whole shipped catalogue. The process exits non-zero if any
// file has an error.

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { validateWorkflowFile } from '@kilnry/workflows';

/** Validate the given workflow files. Returns the process exit code. */
export async function runWorkflowsValidate(files: string[]): Promise<number> {
  if (files.length === 0) {
    process.stderr.write('Usage: kilnry workflows validate <file.yaml> [more.yaml ...]\n');
    return 2;
  }
  let hadError = false;
  for (const file of files) {
    const fileName = basename(file).replace(/\.ya?ml$/i, '');
    let yaml: string;
    try {
      yaml = await readFile(file, 'utf8');
    } catch (error) {
      hadError = true;
      process.stderr.write(
        `${file}: cannot read (${error instanceof Error ? error.message : String(error)}).\n`,
      );
      continue;
    }
    const result = validateWorkflowFile(yaml, fileName);
    const errors = result.issues.filter((issue) => issue.level === 'error');
    const warnings = result.issues.filter((issue) => issue.level === 'warning');
    if (result.ok && warnings.length === 0) {
      process.stdout.write(`${file}: ok\n`);
      continue;
    }
    if (!result.ok) hadError = true;
    process.stdout.write(`${file}: ${result.ok ? 'ok with warnings' : 'invalid'}\n`);
    for (const issue of [...errors, ...warnings]) {
      process.stdout.write(`  [${issue.level} ${issue.rule}] ${issue.message}\n`);
    }
  }
  return hadError ? 1 : 0;
}

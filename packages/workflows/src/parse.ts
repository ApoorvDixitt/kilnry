// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Parse a workflow YAML file into a typed WorkflowFile (F-WFL-06, TRD-12 §1).
// The YAML is read with the pinned yaml package, the id is canonicalised so both
// the `kilnry-<name>` and `kilnry.<name>` spellings resolve, and the result is
// validated against the schema. Parsing fails closed: a file that is not YAML,
// or that does not match the schema, throws a WorkflowParseError naming the first
// problem, so the validator and the CLI can report it.

import { parse as parseYaml } from 'yaml';
import type * as z from 'zod';
import { WorkflowFileSchema, type WorkflowFile } from './schema.js';

export class WorkflowParseError extends Error {
  readonly issues: string[];
  constructor(message: string, issues: string[] = []) {
    super(message);
    this.name = 'WorkflowParseError';
    this.issues = issues;
  }
}

// PRD-10 writes some ids `kilnry.<name>`; the file name and catalogue use
// `kilnry-<name>`. Canonicalise a leading `kilnry.` to `kilnry-` so both resolve
// to one id. Only the first segment is rewritten; later dots (a semver-like tail)
// are left alone.
export function canonicaliseId(id: string): string {
  return id.startsWith('kilnry.') ? `kilnry-${id.slice('kilnry.'.length)}` : id;
}

/** Parse and validate a workflow from its YAML text. */
export function parseWorkflow(yaml: string): WorkflowFile {
  let raw: unknown;
  try {
    raw = parseYaml(yaml, { uniqueKeys: true });
  } catch (error) {
    throw new WorkflowParseError(
      `workflow YAML does not parse: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new WorkflowParseError('workflow YAML must be a mapping at the top level');
  }
  const withId = raw as Record<string, unknown>;
  if (typeof withId.id === 'string') withId.id = canonicaliseId(withId.id);
  const parsed = WorkflowFileSchema.safeParse(withId);
  if (!parsed.success) {
    const issues = formatIssues(parsed.error);
    throw new WorkflowParseError(`workflow does not match the schema: ${issues[0] ?? 'invalid'}`, issues);
  }
  return parsed.data;
}

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

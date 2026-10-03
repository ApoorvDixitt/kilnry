// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Fill a workflow's inputs with the JSON-Schema defaults the drawer would show,
// so planning a workflow with only its required inputs does not read an
// undefined optional (a plan that cannot plan a shipped workflow is a defect,
// F-WFL-06). The drawer applies these defaults client-side; the plan route needs
// the same so an API caller or a sparse payload still prices.

import type { WorkflowFile } from './schema.js';

interface SchemaProperty {
  default?: unknown;
}

export function applyInputDefaults(
  workflow: WorkflowFile,
  inputs: Record<string, unknown>,
): Record<string, unknown> {
  const schema = workflow.inputs as { properties?: Record<string, SchemaProperty> } | undefined;
  const properties = schema?.properties ?? {};
  const resolved: Record<string, unknown> = { ...inputs };
  for (const [key, property] of Object.entries(properties)) {
    if (resolved[key] === undefined && property.default !== undefined) {
      resolved[key] = property.default;
    }
  }
  return resolved;
}

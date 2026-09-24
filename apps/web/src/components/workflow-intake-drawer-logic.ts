// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Pure helpers for the workflow intake drawer (F-WFL-02). Kept out of the
// component so the field-reading and plan-total logic are unit-testable.

export interface WorkflowInputField {
  name: string;
  type: string;
  description?: string;
  required: boolean;
  default?: unknown;
  enum?: string[];
  widget: string;
  labels?: Record<string, string>;
  options?: Array<string | number>;
  unit?: string;
  help?: string;
}

export interface PlanStepView {
  step_id: string;
  name: string;
  kind: string;
  detail?: string;
  model?: string;
  provider?: string;
  estimate_usd: number;
  eta_s: number;
  approval?: boolean;
}

export interface PlanView {
  workflow_id: string;
  total_estimate_usd: number;
  eta_s: number;
  steps: PlanStepView[];
  warnings: string[];
}

interface JsonSchemaProperty {
  type?: string;
  description?: string;
  enum?: string[];
  default?: unknown;
  'x-kilnry'?: {
    widget?: string;
    labels?: Record<string, string>;
    options?: Array<string | number>;
    unit?: string;
    help?: string;
  };
}

interface InputsSchema {
  required?: string[];
  properties?: Record<string, JsonSchemaProperty>;
}

/** Read the workflow's inputs JSON Schema into the fields the drawer renders. */
export function readInputFields(inputs: Record<string, unknown> | undefined): WorkflowInputField[] {
  const schema = (inputs ?? {}) as InputsSchema;
  const required = new Set(schema.required ?? []);
  const properties = schema.properties ?? {};
  return Object.entries(properties).map(([name, property]) => {
    const hint = property['x-kilnry'] ?? {};
    const field: WorkflowInputField = {
      name,
      type: property.type ?? 'string',
      required: required.has(name),
      widget: hint.widget ?? widgetForType(property.type ?? 'string', Boolean(property.enum)),
    };
    if (property.description !== undefined) field.description = property.description;
    if (property.default !== undefined) field.default = property.default;
    if (property.enum !== undefined) field.enum = property.enum;
    if (hint.labels !== undefined) field.labels = hint.labels;
    if (hint.options !== undefined) field.options = hint.options;
    if (hint.unit !== undefined) field.unit = hint.unit;
    if (hint.help !== undefined) field.help = hint.help;
    return field;
  });
}

// The default widget when x-kilnry does not name one.
function widgetForType(type: string, hasEnum: boolean): string {
  if (hasEnum) return 'select';
  if (type === 'integer' || type === 'number') return 'number';
  if (type === 'boolean') return 'toggle';
  if (type === 'array') return 'tags';
  return 'text';
}

/** The initial value for a field: its schema default, else an empty value. */
export function initialValue(field: WorkflowInputField): unknown {
  if (field.default !== undefined) return field.default;
  if (field.widget === 'toggle') return false;
  if (field.widget === 'tags' || field.type === 'array') return [];
  return '';
}

/** The starting input values for a workflow's fields. */
export function initialInputs(fields: WorkflowInputField[]): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of fields) values[field.name] = initialValue(field);
  return values;
}

/** Which required fields are still empty, so Run can ask rather than fail. */
export function missingRequired(fields: WorkflowInputField[], values: Record<string, unknown>): string[] {
  return fields
    .filter((field) => field.required)
    .filter((field) => {
      const value = values[field.name];
      return value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
    })
    .map((field) => field.name);
}

/** The per-step cost line in the plan preview. */
export function stepCostLabel(step: PlanStepView): string {
  if (step.estimate_usd <= 0) return 'no spend';
  return `$${step.estimate_usd.toFixed(2)}`;
}

/** The plan total, formatted as money. */
export function totalLabel(plan: PlanView): string {
  return `$${plan.total_estimate_usd.toFixed(2)}`;
}

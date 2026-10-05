// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Intake constraints the DSL cannot express in JSON Schema (TRD-12 §2, D-59). A
// `media` widget may carry `x-kilnry.duration_s: { min, max }`; the planner
// probes the chosen asset (a free local op) and fails the plan with INVALID_INPUT
// and the input's named reason before any approval or spend. An approval step is
// never used as a refusal: Approve proceeds, a refusal does not.

import { KilnryError } from '@kilnry/core';
import type { WorkflowFile } from './schema.js';

export interface DurationConstraint {
  min?: number;
  max?: number;
}

export interface InputConstraint {
  name: string;
  duration_s: DurationConstraint;
}

interface InputProperty {
  'x-kilnry'?: { widget?: string; duration_s?: DurationConstraint };
}

/** The inputs that carry a duration_s constraint, in schema order. */
export function inputConstraints(workflow: WorkflowFile): InputConstraint[] {
  const schema = workflow.inputs as { properties?: Record<string, InputProperty> } | undefined;
  const out: InputConstraint[] = [];
  for (const [name, property] of Object.entries(schema?.properties ?? {})) {
    const hint = property['x-kilnry'];
    if (hint?.widget === 'media' && hint.duration_s && typeof hint.duration_s === 'object') {
      out.push({ name, duration_s: hint.duration_s });
    }
  }
  return out;
}

/** The named reason a duration refusal carries (also shown inline by the drawer). */
export function durationReason(name: string, seconds: number, range: DurationConstraint): string {
  const rounded = Math.round(seconds * 10) / 10;
  const window =
    range.min !== undefined && range.max !== undefined
      ? `${range.min}–${range.max} s`
      : range.min !== undefined
        ? `at least ${range.min} s`
        : `at most ${range.max} s`;
  return `${name} is ${rounded} s; this workflow takes ${window}.`;
}

export function durationOutside(seconds: number, range: DurationConstraint): boolean {
  return (range.min !== undefined && seconds < range.min) || (range.max !== undefined && seconds > range.max);
}

/**
 * Check every constrained input against its probed duration. `probe` returns the
 * media's duration in seconds, or undefined when the value is not a probeable
 * asset (an empty optional input, a URL the planner cannot read). Throws the
 * first refusal as INVALID_INPUT whose details name the input and the reason.
 */
export async function checkInputConstraints(
  workflow: WorkflowFile,
  inputs: Record<string, unknown>,
  probe: (value: string) => Promise<number | undefined>,
): Promise<void> {
  for (const constraint of inputConstraints(workflow)) {
    const value = inputs[constraint.name];
    const refs = Array.isArray(value) ? value : [value];
    for (const ref of refs) {
      if (typeof ref !== 'string' || ref === '') continue;
      const seconds = await probe(ref);
      if (seconds === undefined) continue;
      if (durationOutside(seconds, constraint.duration_s)) {
        const reason = durationReason(constraint.name, seconds, constraint.duration_s);
        throw new KilnryError('INVALID_INPUT', reason, {
          details: { input: constraint.name, reason, duration_s: seconds, ...constraint.duration_s },
        });
      }
    }
  }
}

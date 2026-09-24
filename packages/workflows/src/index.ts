// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

export {
  evaluateExpression,
  renderString,
  renderDeep,
  TemplateError,
  FUNCTION_NAMES,
  type Scope,
} from './template.js';

export {
  WorkflowFileSchema,
  StepSchema,
  Id,
  MediaRef,
  TransformOpSchema,
  FfmpegOpSchema,
  InternalAssemblyOpSchema,
  AnalyzeTaskSchema,
  ErrorCodeSchema,
  RouteConstraintsSchema,
  RetrySchema,
  type WorkflowFile,
  type Step,
  type BranchStepValue,
  type ForeachStepValue,
  type TransformOp,
  type FfmpegOp,
  type InternalAssemblyOp,
  type AnalyzeTask,
  type ErrorCode,
} from './schema.js';

export { parseWorkflow, canonicaliseId, WorkflowParseError } from './parse.js';

export {
  validateWorkflow,
  validateWorkflowFile,
  type WorkflowIssue,
  type ValidationResult,
} from './validate.js';

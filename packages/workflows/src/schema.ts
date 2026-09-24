// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The Workflow YAML schema (F-WFL-06, TRD-12 §1). A workflow file is parsed with
// the same yaml package the skill format uses, then validated against WorkflowFile
// here. The schema is the single source of truth for the shape of a workflow: its
// top level, its inputs JSON Schema, and every step kind (generate, transform,
// assemble, analyze, approval, branch, foreach, set, export). The planner and
// executor consume the parsed, typed value; the validator (validate.ts) layers
// the cross-references and security rules of §7 on top.
//
// The op enums (transform, ffmpeg, analyze) mirror the kilnry_transform,
// kilnry_ffmpeg and kilnry_analyze tool vocabularies (TRD-10 §3.2). The ffmpeg
// vocabulary is the full set the shipped workflows reference (TRD-12 §6.3); the
// executor maps each to the media package's implementation and names the
// milestone for any op that is not served yet.

import * as z from 'zod';
import { CapabilitySchema, KindSchema, MediaRoleSchema } from '@kilnry/core/types';

// A workflow id: lower-case, digits, dots and hyphens. Shipped ids are written
// `kilnry-<name>`; PRD-10 also writes some `kilnry.<name>`. The loader
// canonicalises `kilnry.` → `kilnry-` so both resolve; the regex admits both.
export const Id = z.string().regex(/^[a-z0-9][a-z0-9.-]{1,63}$/);

// Any string may contain {{ }} templates; the engine (template.ts) evaluates them.
export const Expr = z.string();

// A media reference is an asset ULID, a Library-relative path, an https URL, or
// an expression that yields one of those at run time.
export const MediaRef = z.union([z.string().ulid(), z.string().startsWith('/'), z.string().url(), Expr]);

// The retryable error codes a step may name in `retry.on` (TRD-20 §1 subset the
// executor acts on).
export const ErrorCodeSchema = z.enum([
  'PROVIDER_ERROR',
  'TIMEOUT',
  'RATE_LIMITED',
  'MODERATION_REJECTED',
  'NO_PROVIDER',
  'DOWNLOAD_FAILED',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

// kilnry_transform operations (TRD-10 §3.2). A transform step is a call to that
// tool with source: 'workflow'.
export const TransformOpSchema = z.enum([
  'upscale',
  'bg_remove',
  'reframe',
  'outpaint',
  'lipsync',
  'transcribe',
  'dubbing',
  'voice_change',
]);
export type TransformOp = z.infer<typeof TransformOpSchema>;

// kilnry_ffmpeg operations the shipped workflows use (TRD-12 §6.3). The executor
// maps each to the media package; ops not yet served name their milestone.
export const FfmpegOpSchema = z.enum([
  'probe',
  'thumbnail',
  'sprite_sheet',
  'extract_frames',
  'trim',
  'concat',
  'resize',
  'pad_to_aspect',
  'gif',
  'extract_audio',
  'mux_audio',
  'speed',
  'loop',
  'overlay_image',
  'overlay_text',
  'burn_captions',
  'normalize_audio',
]);
export type FfmpegOp = z.infer<typeof FfmpegOpSchema>;

// sharp ops available to workflows and the Characters UI only, not to
// kilnry_ffmpeg over MCP (§6.3).
export const InternalAssemblyOpSchema = z.enum(['split_grid']);
export type InternalAssemblyOp = z.infer<typeof InternalAssemblyOpSchema>;

// kilnry_analyze tasks (TRD-10 §3.2).
export const AnalyzeTaskSchema = z.enum([
  'describe',
  'consistency_check',
  'qa_check',
  'tag',
  'caption',
  'score',
]);
export type AnalyzeTask = z.infer<typeof AnalyzeTaskSchema>;

// Route constraints the planner passes to the registry router (subset of the
// registry's constraint shape that a workflow step may set).
export const RouteConstraintsSchema = z.object({
  quality: z.enum(['draft', 'standard', 'premium']).optional(),
  needs_audio: z.union([z.boolean(), Expr]).optional(),
  refs_count: z.union([z.number().int(), Expr]).optional(),
  duration_s: z.union([z.number(), Expr]).optional(),
  min_resolution: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export const RetrySchema = z.object({
  max: z.number().int().min(0).max(3).default(1),
  on: z.array(ErrorCodeSchema).default(['PROVIDER_ERROR', 'TIMEOUT', 'RATE_LIMITED']),
  reword: z.boolean().default(false),
  backoff_s: z.number().default(5),
});

// `approval` on any step: true ≡ 'hard' (PRD-10 §3). hard waits everywhere; soft
// posts the card and proceeds in Run-automatically or when the user ticked
// "Skip approvals".
export const InlineApprovalSchema = z.union([z.boolean(), z.enum(['hard', 'soft'])]).default(false);

// Fields common to every step.
const baseShape = {
  id: Id,
  name: z.string().optional(),
  when: Expr.optional(),
  depends_on: z.array(Id).default([]),
  on_fail: z.enum(['fail', 'skip', 'continue']).default('fail'),
  retry: RetrySchema.optional(),
  outputs: z.record(z.string(), Expr).default({}),
  cost: z.object({ hint_usd: z.number().optional(), note: z.string().optional() }).optional(),
  approval: InlineApprovalSchema,
  timeout_s: z.number().int().default(1800),
};

const MediaItem = z.object({
  role: MediaRoleSchema,
  ref: MediaRef,
  label: z.string().optional(),
  weight: z.number().optional(),
  when: Expr.optional(),
});

export const GenerateStep = z.object({
  ...baseShape,
  kind: z.literal('generate'),
  capability: z.union([CapabilitySchema, Expr]),
  kind_of: KindSchema.optional(),
  model: z.string().default('auto'),
  alternates: z.union([z.array(z.string()), Expr]).default([]),
  constraints: RouteConstraintsSchema.partial().optional(),
  prompt: Expr,
  negative_prompt: Expr.optional(),
  params: z.record(z.string(), z.unknown()).default({}),
  medias: z.union([z.array(MediaItem), Expr]).default([]),
  characters: z.array(Expr).default([]),
  count: z.union([z.number().int().min(1).max(4), Expr]).default(1),
  filename: Expr.optional(),
});

export const TransformStep = z.object({
  ...baseShape,
  kind: z.literal('transform'),
  op: TransformOpSchema,
  source: MediaRef,
  params: z.record(z.string(), z.unknown()).default({}),
  model: z.string().default('auto'),
});

export const AssembleStep = z.object({
  ...baseShape,
  kind: z.literal('assemble'),
  op: z.union([FfmpegOpSchema, InternalAssemblyOpSchema]),
  inputs: z.union([z.array(MediaRef).min(1), Expr]),
  params: z.record(z.string(), z.unknown()).default({}),
  output_name: Expr.optional(),
});

export const AnalyzeStep = z.object({
  ...baseShape,
  kind: z.literal('analyze'),
  task: AnalyzeTaskSchema,
  refs: z.union([z.array(MediaRef), Expr]).default([]),
  instructions: Expr.optional(),
  schema: z.record(z.string(), z.unknown()).optional(),
  model: z.string().default('auto'),
  character: Expr.optional(),
});

export const ApprovalStep = z.object({
  ...baseShape,
  kind: z.literal('approval'),
  title: Expr,
  message: Expr.optional(),
  show: z.array(Expr).default([]),
  options: z.array(z.object({ id: z.string(), label: z.string() })).default([
    { id: 'approve', label: 'Approve' },
    { id: 'deny', label: 'Deny' },
  ]),
  mode: z.enum(['hard', 'soft']).default('hard'),
  skippable: z.boolean().default(true),
  timeout_h: z.number().default(24),
});

export const SetStep = z.object({
  ...baseShape,
  kind: z.literal('set'),
  values: z.record(z.string(), Expr),
});

export const ExportStep = z.object({
  ...baseShape,
  kind: z.literal('export'),
  files: z.array(z.object({ ref: MediaRef, name: Expr.optional(), tags: z.array(Expr).default([]) })),
  register_references: z
    .object({
      character: Expr,
      role: Expr,
      view: Expr.optional(),
      label: Expr.optional(),
      appearance: Expr.optional(),
      skip_tags: z.array(z.string()).default([]),
    })
    .optional(),
  manifest: z.boolean().default(true),
});

// branch and foreach nest steps, so the step union is recursive. Zod 4 expresses
// the recursion with a lazy union whose element type is annotated once, breaking
// the circular inference. The leaf step types are inferred from their schemas;
// branch and foreach add their nested step arrays on top.
type LeafStep =
  | z.infer<typeof GenerateStep>
  | z.infer<typeof TransformStep>
  | z.infer<typeof AssembleStep>
  | z.infer<typeof AnalyzeStep>
  | z.infer<typeof ApprovalStep>
  | z.infer<typeof SetStep>
  | z.infer<typeof ExportStep>;

interface BranchStepValue {
  kind: 'branch';
  id: string;
  name?: string;
  when: string;
  then: Step[];
  else: Step[];
  depends_on: string[];
  on_fail: 'fail' | 'skip' | 'continue';
  outputs: Record<string, string>;
  approval: boolean | 'hard' | 'soft';
  timeout_s: number;
  retry?: z.infer<typeof RetrySchema>;
  cost?: { hint_usd?: number; note?: string };
}

interface ForeachStepValue {
  kind: 'foreach';
  id: string;
  name?: string;
  when?: string;
  over: string;
  as: string;
  index_as: string;
  expect?: string;
  concurrency: number;
  steps: Step[];
  depends_on: string[];
  on_fail: 'fail' | 'skip' | 'continue';
  outputs: Record<string, string>;
  approval: boolean | 'hard' | 'soft';
  timeout_s: number;
  retry?: z.infer<typeof RetrySchema>;
  cost?: { hint_usd?: number; note?: string };
}

export type Step = LeafStep | BranchStepValue | ForeachStepValue;
export type { BranchStepValue, ForeachStepValue };

// The nested step arrays reference the step union through getters, so the schema
// objects are defined before StepSchema and the reference is resolved lazily at
// validation time. Only StepSchema carries an explicit element type, which
// breaks the otherwise-circular inference; branch and foreach are left to infer.
export const BranchStep = z.object({
  ...baseShape,
  kind: z.literal('branch'),
  when: Expr,
  get then() {
    return z.array(StepSchema);
  },
  get else() {
    return z.array(StepSchema).default([]);
  },
});

export const ForeachStep = z.object({
  ...baseShape,
  kind: z.literal('foreach'),
  over: Expr,
  as: z.string().default('item'),
  index_as: z.string().default('index'),
  expect: Expr.optional(),
  concurrency: z.number().int().min(1).max(12).default(4),
  get steps() {
    return z.array(StepSchema).min(1);
  },
});

export const StepSchema: z.ZodType<Step> = z.union([
  GenerateStep,
  TransformStep,
  AssembleStep,
  AnalyzeStep,
  ApprovalStep,
  SetStep,
  ExportStep,
  BranchStep,
  ForeachStep,
]) as z.ZodType<Step>;

export const WorkflowFileSchema = z.object({
  id: Id,
  name: z.string().max(80),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string().max(1024).optional(),
  category: z.enum(['ads', 'characters', 'video', 'audio', 'image', 'utility']),
  requires: z.array(CapabilitySchema).default([]),
  inputs: z.record(z.string(), z.unknown()).default({ type: 'object', properties: {} }),
  defaults: z.record(z.string(), z.unknown()).default({}),
  budget: z
    .object({ max_usd: z.number().nonnegative(), warn_usd: z.number().nonnegative().optional() })
    .optional(),
  steps: z.array(StepSchema).min(1),
  outputs: z
    .object({ final: Expr.optional(), extras: z.array(Expr).default([]) })
    .partial()
    .default({}),
});

export type WorkflowFile = z.infer<typeof WorkflowFileSchema>;

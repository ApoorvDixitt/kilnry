// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Declarative pipelines (TRD-13 §5, D-45). A skill may ship
// scripts/<name>.pipeline.json that maps to allow-listed local operations run
// only through kilnry_ffmpeg / kilnry_analyze — there is no interpreter, no
// shell, no JavaScript. This schema is what the skill validator (V7) checks
// every file under scripts/ against; any file in scripts/ that is not a JSON
// pipeline is a validation error, because V1 does not execute skill code.

import * as z from 'zod';

export const DeclarativePipelineSchema = z.object({
  schema_version: z.literal(1),
  name: z.string(),
  description: z.string().max(300),
  inputs: z.record(
    z.string(),
    z.object({
      type: z.enum(['media', 'text', 'number', 'boolean']),
      required: z.boolean().default(true),
    }),
  ),
  steps: z
    .array(
      z.object({
        id: z.string(),
        tool: z.enum(['kilnry_ffmpeg', 'kilnry_analyze']),
        op: z.string(),
        inputs: z.array(z.string()),
        params: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .max(20),
  output: z.string(),
});

export type DeclarativePipeline = z.infer<typeof DeclarativePipelineSchema>;

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import * as z from 'zod';

export const ThemeSchema = z.enum(['system', 'light', 'dark']);
export const DensitySchema = z.enum(['comfortable', 'compact']);
export const ReducedMotionSchema = z.enum(['system', 'reduce', 'no-preference']);

export const KilnryConfigSchema = z.object({
  schema_version: z.literal(1).default(1),
  port: z.number().int().min(1).max(65_535).default(3123),
  host: z.string().default('127.0.0.1'),
  data_dir: z.string(),
  library_root: z.string().optional(),
  theme: ThemeSchema.default('system'),
  density: DensitySchema.default('comfortable'),
  reduced_motion: ReducedMotionSchema.default('system'),
  lan_enabled: z.boolean().default(false),
  onboarding_complete: z.boolean().default(false),
  update_check: z.boolean().default(false),
  update_channel: z.enum(['stable', 'beta']).default('stable'),
  // The default Model Context Protocol (MCP) bearer token used by the stdio
  // bridge (npx kilnry mcp). Written when the default token is minted in
  // Settings › MCP (F-MCP-05); absent until then. Stored here so the bridge can
  // read it without opening the database (D-12).
  mcp_token: z.string().optional(),
});

export type KilnryConfig = z.infer<typeof KilnryConfigSchema>;

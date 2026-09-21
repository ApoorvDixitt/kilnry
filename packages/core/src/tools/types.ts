// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The shared tool contract (TRD-10 §2.9). One module per tool exports a
// KilnryTool; two thin registrars (the Model Context Protocol server and, in a
// later milestone, Chat) wrap the same definitions so both surfaces run exactly
// one implementation. Each tool has a name, a short description, flat Zod input
// and output schemas, behaviour annotations, and an async execute.

import type { ZodTypeAny } from 'zod';
import type { DatabaseState } from '@kilnry/db';
import type { JobEngine } from '../jobs/engine.js';
import type { AdapterRegistry } from '../providers/adapter.js';

// Behaviour hints a client host reads before calling a tool (TRD-10 §2.3).
export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

// The caller's scope and the services a tool needs to run. Read-only catalogue
// tools use only the database; pricing and provider tools also need the job
// engine and the provider adapters (both core objects). Spending tools receive
// more in later units.
export interface ToolServices {
  db: DatabaseState;
  scope: 'full' | 'read_only';
  engine?: JobEngine;
  adapters?: AdapterRegistry;
  // Generations at or below this cost run without a confirmation round trip
  // (F-MCP-06). Absent means every non-zero spend needs confirmation.
  autoApproveBelowUsd?: number;
  // The Library root and its id, for tools that read or change files on disk
  // (kilnry_library_manage, kilnry_import). Absent when the Library is not set.
  libraryRoot?: string;
  libraryId?: string;
  // An OpenRouter key and a way to turn an asset id into a loopback media URL,
  // for the vision-language analyze tool. Absent when no key is configured.
  openrouterKey?: string;
  assetUrl?: (assetId: string) => string;
  // The bundled and installed skill roots for the kilnry_skills tool (F-SKL-01).
  // Absent means no skills are available and listing returns an empty set.
  skillsRoots?: { bundled: string; installed?: string };
  // The preset catalogue for the kilnry_presets tool (F-PRE-04). It is supplied
  // rather than imported because the preset package reads this one: the caller
  // passes the reader in, which also lets a test hand over a small catalogue.
  // Absent means no presets are installed and listing returns an empty set.
  presets?: PresetCatalogueServices;
  // Identity training for the kilnry_characters_manage.train action (F-CHR-07).
  // Supplied by the caller (the web app) because it needs provider keys, the
  // adapters and the on-disk identities folder; absent means training is not
  // available on this surface and the action returns not-available.
  training?: TrainingRunner;
}

/** What the train action needs: consent-gated identity training. */
export interface TrainingRunner {
  start(input: {
    handle: string;
    trainer: 'fal' | 'replicate' | 'higgsfield';
    steps?: number;
    trigger_word?: string;
    confirmed_cost_usd: number;
    cost_usd?: number;
  }): Promise<{
    identity_id: string;
    provider: string;
    kind: string;
    status: 'ready' | 'failed';
    local_path?: string;
    remote_id?: string;
    error?: string;
  }>;
}

/** What the presets tool needs: the catalogue, and a preset filled in. */
export interface PresetCatalogueServices {
  list(query?: { category?: string; query?: string }): PresetSummary[];
  get(id: string): PresetSummary | undefined;
  /** A preset with its slot values applied, ready to become a request. */
  resolve(
    id: string,
    values: Record<string, string | number>,
  ):
    | {
        kind: string;
        model: string;
        prompt: string;
        negative_prompt?: string;
        params: Record<string, unknown>;
        medias: Array<{ role: string; ref: string }>;
        count: number;
        missing: string[];
        target_folder?: string;
      }
    | undefined;
}

/** One preset as the tool reports it. */
export interface PresetSummary {
  id: string;
  name: string;
  category: string;
  description: string;
  kind: string;
  model: string;
  indicative_cost_usd?: number;
  slots: Array<{ name: string; type: string; label: string; required: boolean }>;
  needs: string[];
  source: string;
  enabled: boolean;
}

// A tool result: a human summary for content[0].text (≤ 600 chars, no raw JSON)
// and structuredContent matching the tool's outputSchema (TRD-10 §2.4).
export interface ToolResult {
  text: string;
  structuredContent: Record<string, unknown>;
}

// One tool. inputSchema and outputSchema are flat records of Zod fields so the
// Model Context Protocol server can pass them straight to registerTool.
export interface KilnryTool {
  name: string;
  description: string;
  inputSchema: Record<string, ZodTypeAny>;
  outputSchema: Record<string, ZodTypeAny>;
  annotations: ToolAnnotations;
  execute: (input: Record<string, unknown>, services: ToolServices) => Promise<ToolResult>;
}

// A read-only token may call only tools whose readOnlyHint is true (TRD-10 §7).
export function toolAllowedForScope(
  tool: Pick<KilnryTool, 'annotations'>,
  scope: 'full' | 'read_only',
): boolean {
  if (scope === 'full') return true;
  return tool.annotations.readOnlyHint === true;
}

// A structured error result (TRD-10 §2.8): tools never throw; they return an
// error object under structuredContent.error with a code from TRD-20.
export function toolError(
  code: string,
  message: string,
  extra: { retryable?: boolean; provider?: string; provider_code?: string } = {},
): ToolResult {
  return {
    text: message,
    structuredContent: {
      error: { code, message, retryable: extra.retryable ?? false, ...extra },
    },
  };
}

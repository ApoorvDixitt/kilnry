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
  // Which surface invoked a spending tool, and who confirmed the spend it makes.
  // The confirmer follows TRD-04: "user" for a call the approval card answered,
  // "auto" for one a policy or threshold let through, and "mcp:<token_id>" for a
  // Model Context Protocol client. It may be resolved per call, because one chat
  // turn can contain both an approved call and an automatic one.
  jobSource?: 'chat' | 'mcp';
  confirmedBy?: string | ((name: string, input: Record<string, unknown>) => string);
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
  skillsRoots?: { bundled: string; installed?: string; disabled?: Set<string> };
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
  // Voice cloning for the kilnry_voices.clone action (F-VOI-02). Supplied by the
  // caller because it needs provider keys; absent means cloning is not available
  // on this surface.
  voiceCloner?: VoiceCloner;
  // Voice preview for the kilnry_voices.preview action (F-VOI-01). Supplied by
  // the caller because it needs provider keys; absent means preview is not
  // available on this surface.
  voicePreviewer?: VoicePreviewer;
  // Voice deletion for the kilnry_voices.delete action (F-VOI-01). Absent means
  // deletion is not available on this surface.
  voiceDeleter?: VoiceDeleter;
  // Export bundle builder for kilnry_library_manage.export_bundle (F-LIB-14).
  // Supplied by the caller because it needs the media package's strip and label
  // helpers; absent means export is not available on this surface.
  bundleExporter?: BundleExporter;
}

/** What the export_bundle action needs: build a bundle from chosen assets. */
export interface BundleExporter {
  export(options: {
    asset_ids: string[];
    format?: 'zip' | 'folder' | undefined;
    include_sidecars?: boolean | undefined;
    metadata?: 'keep' | 'strip' | 'embed_if_missing' | undefined;
    provenance?: 'none' | 'iptc' | 'c2pa' | 'both' | undefined;
    include_lineage?: boolean | undefined;
    manifest?: boolean | undefined;
    rename?: boolean | undefined;
  }): Promise<{
    bundle_id: string;
    bundle_path: string;
    format: string;
    entries: unknown[];
    notes: string[];
  }>;
}

/** What the clone action needs: consent-gated voice cloning. */
export interface VoiceCloner {
  clone(input: {
    name: string;
    provider: 'minimax' | 'elevenlabs' | 'fal';
    sample_url: string;
    sample_seconds: number;
    consent_confirmed: boolean;
    confirmed_cost_usd: number;
    bind_to?: string;
  }): Promise<{ voice_ulid: string; provider: string; voice_id: string; bound_to?: string }>;
}

/** What the preview action needs: a priced, budget-checked voice preview. */
export interface VoicePreviewer {
  preview(input: {
    provider: string;
    voiceId: string;
    text?: string;
  }): Promise<{ bytes: Uint8Array; mime: string; estimate_usd: number }>;
}

/** What the delete action needs: remove a stored voice and its bindings. */
export interface VoiceDeleter {
  delete(voiceUlid: string): Promise<boolean>;
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
  // When a tool is not read-only overall (readOnlyHint: false) but some of its
  // actions do not change state, they are listed here so a read-only token may
  // still call those actions (TRD-10 §7). The action is read from input.action.
  readOnlyActions?: readonly string[];
  execute: (input: Record<string, unknown>, services: ToolServices) => Promise<ToolResult>;
}

// Whether a token of the given scope may run this tool for this call (TRD-10 §7).
// A full token may run anything. A read-only token may run a tool whose
// readOnlyHint is true, or — for a mixed tool — a call whose action is one of the
// tool's declared read-only actions, so listing and previewing stay available
// while a state-changing action such as clone or delete is refused.
export function toolAllowedForScope(
  tool: Pick<KilnryTool, 'annotations' | 'readOnlyActions'>,
  scope: 'full' | 'read_only',
  input?: Record<string, unknown>,
): boolean {
  if (scope === 'full') return true;
  if (tool.annotations.readOnlyHint === true) return true;
  if (tool.readOnlyActions && input) {
    const action = typeof input.action === 'string' ? input.action : 'list';
    return tool.readOnlyActions.includes(action);
  }
  return false;
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

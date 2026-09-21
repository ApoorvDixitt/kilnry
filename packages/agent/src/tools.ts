// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The shared Chat tool registrar (TRD-11 §4). Chat does not define tools: it
// wraps the same twenty implementations the Model Context Protocol server
// exposes, so both surfaces run exactly one code path per tool. The description
// and schemas are passed through unchanged; only the transport differs.
//
// Two rules from TRD-10 carry over. A tool never throws: an error is a value
// the model can read and recover from, so a thrown error is converted into the
// same structured error shape the protocol returns. And what the model sees is
// compacted: preview URLs and inline bytes are dropped while ids, paths, costs
// and errors are kept, because the model must work with identifiers rather than
// pixels and a large tool result would crowd the context window.

import { KILNRY_TOOLS, type KilnryTool, type ToolServices } from '@kilnry/core';
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';

/** What the model is allowed to see of one tool result, in bytes. */
export const MODEL_OUTPUT_BUDGET = 4 * 1024;

/** Keys that never reach the model: previews, inline bytes and raw payloads. */
const DROPPED_KEYS = new Set([
  'preview_urls',
  'preview_url',
  'audio_data_uri',
  'base64',
  'b64_json',
  'bytes',
  'data_uri',
  'thumbnail',
  'payload_redacted',
]);

/**
 * Reduce a tool result to what is useful to the model (TRD-11 §4). Drops
 * preview and byte-bearing fields, then trims the serialised form to the output
 * budget so one tool call cannot crowd out the conversation.
 */
export function compactForModel(output: Record<string, unknown>, budget = MODEL_OUTPUT_BUDGET): string {
  const compact = prune(output);
  let text = JSON.stringify(compact);
  if (Buffer.byteLength(text, 'utf8') <= budget) return text;
  // Too large: keep the summary and the fields the model needs to continue.
  const essential: Record<string, unknown> = {};
  for (const key of ['_summary', 'error', 'job_id', 'asset_ids', 'paths', 'cost_usd', 'estimate_usd']) {
    if (key in compact) essential[key] = compact[key];
  }
  text = JSON.stringify(essential);
  if (Buffer.byteLength(text, 'utf8') <= budget) return text;
  return JSON.stringify({ _summary: String(compact['_summary'] ?? 'Result too large to show.') }).slice(
    0,
    budget,
  );
}

function prune(value: unknown, depth = 0): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!value || typeof value !== 'object') return out;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (DROPPED_KEYS.has(key)) continue;
    if (entry && typeof entry === 'object' && !Array.isArray(entry) && depth < 4) {
      out[key] = prune(entry, depth + 1);
    } else if (Array.isArray(entry) && depth < 4) {
      out[key] = entry.map((item) => (item && typeof item === 'object' ? prune(item, depth + 1) : item));
    } else {
      out[key] = entry;
    }
  }
  return out;
}

/** The context a Chat tool call runs in: the services plus the session it serves. */
export interface ChatToolContext {
  services: ToolServices;
  /** The session these calls belong to, reported with each tool result. */
  chatSessionId?: string;
  /** Called after each tool call so the Steps and Cost panes can update. */
  onToolResult?: (event: {
    name: string;
    tool_call_id: string;
    summary: string;
    structured: Record<string, unknown>;
  }) => void;
}

/**
 * Wrap the twenty Kilnry tools as AI SDK tools for one chat request (TRD-11
 * §4). Every spend still runs through the same estimate, budget and audit path
 * the composer and the protocol server use; this registrar only adapts shapes.
 */
export function registerChatTools(ctx: ChatToolContext, tools: KilnryTool[] = KILNRY_TOOLS): ToolSet {
  const entries = tools.map((definition) => [definition.name, wrapTool(definition, ctx)] as const);
  return Object.fromEntries(entries) as ToolSet;
}

function wrapTool(definition: KilnryTool, ctx: ChatToolContext) {
  return tool({
    description: definition.description,
    inputSchema: z.object(definition.inputSchema),
    execute: async (input, options): Promise<Record<string, unknown>> => {
      const callId = options?.toolCallId ?? '';
      try {
        const result = await definition.execute(input as Record<string, unknown>, ctx.services);
        ctx.onToolResult?.({
          name: definition.name,
          tool_call_id: callId,
          summary: result.text,
          structured: result.structuredContent,
        });
        return { ...result.structuredContent, _summary: result.text };
      } catch (cause) {
        // A tool must never throw at the model (TRD-10 rule 8): report the
        // failure as a value so the model can explain it or try another route.
        const message = cause instanceof Error ? cause.message : 'The tool failed.';
        const errorResult = {
          error: { code: 'PROVIDER_ERROR', message, retryable: false },
          _summary: message,
        };
        ctx.onToolResult?.({
          name: definition.name,
          tool_call_id: callId,
          summary: message,
          structured: errorResult,
        });
        return errorResult;
      }
    },
    toModelOutput: (output: unknown) => ({
      type: 'text' as const,
      value: compactForModel((output ?? {}) as Record<string, unknown>),
    }),
  });
}

/** The tool names Chat registers, in catalogue order. */
export function chatToolNames(tools: KilnryTool[] = KILNRY_TOOLS): string[] {
  return tools.map((definition) => definition.name);
}

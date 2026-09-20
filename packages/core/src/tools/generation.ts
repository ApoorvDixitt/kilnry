// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Generation, transform, local media, analysis and jobs tools (TRD-10 §3.2 and
// §3.6 jobs). kilnry_generate creates media, kilnry_transform runs provider
// operations on existing media, kilnry_ffmpeg runs free local assembly,
// kilnry_analyze inspects media, and kilnry_jobs waits on and inspects jobs.
// The spend tools estimate first and ask for confirmation before charging; the
// full money-round-trip rules are tightened in the confirmation unit (F-MCP-06).

import * as z from 'zod';
import { toolError, type KilnryTool, type ToolResult, type ToolServices } from './types.js';

const MediaRef = z.string();

const Request = z.object({
  kind: z.enum(['image', 'video', 'audio', '3d', 'image_edit', 'video_edit']),
  prompt: z.string().min(1),
  model: z.string().default('auto'),
  params: z.record(z.string(), z.unknown()).optional(),
  characters: z.array(z.string()).optional(),
  count: z.number().int().min(1).max(4).default(1),
  index: z.number().int().optional(),
});

// kilnry_generate — create images, video, audio, or 3D.
export const generateTool: KilnryTool = {
  name: 'kilnry_generate',
  description:
    'Create images, video, audio, or 3D. One call is one request set; pass up to twelve independent requests for a batch. Reference people and things with @handle or the characters list. Every request costs real money: without a matching confirm_cost_usd the tool returns an estimate and needs_confirmation, and the caller re-calls with the acknowledged cost. Returns a job per request with its estimate and route.',
  inputSchema: {
    requests: z.array(Request).min(1).max(12),
    confirm_cost_usd: z.number().optional(),
    client_request_id: z.string().max(64).optional(),
    wait: z.boolean().default(false),
  },
  outputSchema: {
    jobs: z.array(z.record(z.string(), z.unknown())).optional(),
    total_estimate_usd: z.number().optional(),
    needs_confirmation: z.boolean().optional(),
    error: z.record(z.string(), z.unknown()).optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  async execute(input, services: ToolServices): Promise<ToolResult> {
    if (!services.engine) {
      return toolError('NO_PROVIDER', 'Generation is unavailable because the engine is not running.');
    }
    const requests = Array.isArray(input.requests) ? (input.requests as Array<Record<string, unknown>>) : [];
    if (requests.length === 0) return toolError('INVALID_INPUT', 'At least one request is required.');
    const confirm = typeof input.confirm_cost_usd === 'number' ? input.confirm_cost_usd : undefined;

    // Price every request first so the caller sees the cost before any charge.
    const priced: Array<{
      index: number;
      estimate_usd: number;
      route: unknown;
      request: Record<string, unknown>;
    }> = [];
    let total = 0;
    for (const [position, request] of requests.entries()) {
      try {
        const result = await services.engine.estimate(
          {
            kind: (request.kind as string) ?? 'image',
            prompt: (request.prompt as string) ?? '',
            model: request.model === 'auto' ? undefined : (request.model as string | undefined),
            params: (request.params as Record<string, unknown>) ?? {},
            medias: [],
            count: (request.count as number) ?? 1,
            injections: [],
          } as never,
          {},
        );
        const usd = result.estimate.authoritative_usd ?? result.estimate.estimate_usd;
        total += usd;
        priced.push({
          index: (request.index as number) ?? position,
          estimate_usd: result.estimate.estimate_usd,
          route: result.estimate.route,
          request,
        });
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'code' in error ? String(error.code) : 'PROVIDER_ERROR';
        return toolError(code, error instanceof Error ? error.message : 'Could not price a request.');
      }
    }

    // Money-round-trip (SEP-2322): without an acknowledged cost within ten
    // percent of the estimate, return needs_confirmation and do not charge.
    if (confirm === undefined || confirm < total * 0.9) {
      return {
        text: `About $${total.toFixed(2)} for ${priced.length} request(s). Confirm to run.`,
        structuredContent: {
          needs_confirmation: true,
          total_estimate_usd: Number(total.toFixed(4)),
          jobs: priced.map((entry) => ({
            index: entry.index,
            estimate_usd: entry.estimate_usd,
            route: entry.route,
            status: 'estimated',
          })),
        },
      };
    }

    // Confirmed: create a job per request.
    const created: Array<Record<string, unknown>> = [];
    for (const entry of priced) {
      const request = entry.request;
      const job = await services.engine.createJob({
        request: {
          kind: (request.kind as string) ?? 'image',
          prompt: (request.prompt as string) ?? '',
          model: request.model === 'auto' ? undefined : (request.model as string | undefined),
          params: (request.params as Record<string, unknown>) ?? {},
          medias: [],
          count: (request.count as number) ?? 1,
          injections: [],
        } as never,
        confirmed_cost_usd: entry.estimate_usd,
        confirmed_by: 'mcp',
        ...(typeof input.client_request_id === 'string'
          ? { client_request_id: `${input.client_request_id}:${entry.index}` }
          : {}),
      });
      created.push({
        index: entry.index,
        job_id: job.job_id,
        status: job.status,
        estimate_usd: entry.estimate_usd,
      });
    }
    return {
      text: `Started ${created.length} job(s) for about $${total.toFixed(2)}.`,
      structuredContent: { jobs: created, total_estimate_usd: Number(total.toFixed(4)) },
    };
  },
};

// kilnry_transform — provider-billed operations on existing media.
export const transformTool: KilnryTool = {
  name: 'kilnry_transform',
  description:
    'Run a provider-billed operation on existing media: upscale, remove background, reframe, outpaint, lip-sync, dub, change voice, or transcribe. Give the source as an id, path, or URL, plus the operation parameters. Like generation it estimates first and asks for confirmation before charging. Returns one job with its estimate and route.',
  inputSchema: {
    op: z.enum([
      'upscale_image',
      'upscale_video',
      'bg_remove',
      'reframe',
      'outpaint',
      'lipsync',
      'dubbing',
      'voice_change',
      'transcribe',
    ]),
    source: MediaRef,
    params: z.record(z.string(), z.unknown()).optional(),
    confirm_cost_usd: z.number().optional(),
  },
  outputSchema: {
    jobs: z.array(z.record(z.string(), z.unknown())).optional(),
    needs_confirmation: z.boolean().optional(),
    error: z.record(z.string(), z.unknown()).optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  async execute(): Promise<ToolResult> {
    // The transform providers are wired in a later milestone; until then the
    // tool reports that no provider is configured rather than charging.
    return toolError(
      'NO_PROVIDER',
      'Transform operations need a provider that arrives in a later milestone.',
    );
  },
};

// kilnry_ffmpeg — local, free media assembly with named operations (no raw argv).
export const ffmpegTool: KilnryTool = {
  name: 'kilnry_ffmpeg',
  description:
    'Run a free local FFmpeg operation by name (never raw arguments): probe, trim, concat, overlay, burn captions, extract audio, mux, thumbnail, resize, pad, speed, fade, loop, gif, sprite sheet, or normalise. Give one or more media inputs and the per-operation parameters. Returns the produced asset and a short log; no money is spent.',
  inputSchema: {
    op: z.string(),
    inputs: z.array(MediaRef).min(1),
    params: z.record(z.string(), z.unknown()).optional(),
    output_name: z.string().optional(),
  },
  outputSchema: {
    asset_id: z.string().optional(),
    error: z.record(z.string(), z.unknown()).optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  async execute(): Promise<ToolResult> {
    return toolError(
      'NO_PROVIDER',
      'Local media assembly over the tool interface arrives in a later milestone.',
    );
  },
};

// kilnry_analyze — look at media with a vision-language model or local tools.
export const analyzeTool: KilnryTool = {
  name: 'kilnry_analyze',
  description:
    'Look at media and describe, caption, read text, check consistency against a character, extract a palette, detect faces, or compare. Give one to eight references and an optional instruction. A vision-language task costs a small amount and estimates first; local tasks are free. Returns text and an optional structured result with a confidence badge.',
  inputSchema: {
    task: z.enum([
      'describe',
      'caption',
      'ocr',
      'transcribe_local',
      'qa_check',
      'consistency_check',
      'extract_palette',
      'detect_faces',
      'compare',
    ]),
    refs: z.array(MediaRef).min(1).max(8),
    instructions: z.string().optional(),
    confirm_cost_usd: z.number().optional(),
  },
  outputSchema: {
    text: z.string().optional(),
    error: z.record(z.string(), z.unknown()).optional(),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  async execute(): Promise<ToolResult> {
    return toolError(
      'NO_PROVIDER',
      'Media analysis needs a vision-language provider that arrives in a later milestone.',
    );
  },
};

// kilnry_jobs — wait, inspect, cancel.
export const jobsTool: KilnryTool = {
  name: 'kilnry_jobs',
  description:
    'Wait on, inspect, list, cancel, or retry jobs. Give job ids to wait on or inspect, or a status filter to list. Returns each job with its status, provider, model, estimate, actual cost, progress, produced assets, provider request id, and any error. Waiting and listing never spend; cancel and retry change a job.',
  inputSchema: {
    action: z.enum(['wait', 'status', 'list', 'cancel', 'retry']).default('list'),
    job_ids: z.array(z.string()).max(12).optional(),
    limit: z.number().int().min(1).max(100).default(24),
  },
  outputSchema: {
    jobs: z.array(z.record(z.string(), z.unknown())),
    all_terminal: z.boolean().optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false },
  async execute(input, services: ToolServices): Promise<ToolResult> {
    const { jobs: jobsTable } = await import('@kilnry/db');
    const { desc } = await import('drizzle-orm');
    const limit = typeof input.limit === 'number' ? input.limit : 24;
    const rows = await services.db.db
      .select()
      .from(jobsTable)
      .orderBy(desc(jobsTable.createdAt))
      .limit(limit);
    const list = rows.map((row) => ({
      job_id: row.id,
      status: row.status,
      provider: row.providerId,
      model: row.modelId,
      actual_usd: row.actualUsd === null ? null : Number(row.actualUsd),
      provider_request_id: row.providerRequestId,
      created_at: row.createdAt.toISOString(),
    }));
    const allTerminal = list.every((job) =>
      ['completed', 'failed', 'moderated', 'cancelled'].includes(String(job.status)),
    );
    return {
      text: `${list.length} job(s).`,
      structuredContent: { jobs: list, all_terminal: allTerminal },
    };
  },
};

// The generation, transform, local-media, analysis and jobs group.
export const GENERATION_TOOLS: KilnryTool[] = [
  generateTool,
  transformTool,
  ffmpegTool,
  analyzeTool,
  jobsTool,
];

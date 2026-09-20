// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The Model Context Protocol (MCP) server core (F-MCP-01). Builds one McpServer
// from a list of tool definitions, registers each tool, and serves a
// deterministic tools/list with the caching hint the specification locks in.
// The 20 tool implementations themselves live in @kilnry/core (one module per
// tool) so Chat and MCP share exactly one implementation (TRD-10 §2.9); this
// package only wires them onto the protocol.

import {
  McpServer,
  WebStandardStreamableHTTPServerTransport,
  type ToolAnnotations,
} from '@modelcontextprotocol/server';
import type { ZodTypeAny } from 'zod';

export const MCP_SERVER_NAME = 'kilnry';

// The verbatim server instructions shipped to every client (TRD-10 §6, ≤ 1.5 KB).
export const MCP_INSTRUCTIONS = `Kilnry is a local AI media studio. Tools are grouped: discovery (kilnry_models, kilnry_estimate, kilnry_providers, kilnry_budget), creation (kilnry_generate, kilnry_transform, kilnry_ffmpeg, kilnry_analyze), library (kilnry_library, kilnry_library_manage, kilnry_import), reusable things (kilnry_characters, kilnry_characters_manage, kilnry_voices), templates (kilnry_presets, kilnry_workflows, kilnry_skills), and kilnry_jobs.
Rules: (1) Every generation costs the user real money. Call kilnry_estimate or read the estimate in the tool result, state the price in one line, and pass confirm_cost_usd only after the user agreed, unless the workspace is in Run-automatically mode. (2) Reference people and things with @handle; kilnry_characters resolve_prompt shows exactly what will be sent. (3) For anything multi-step (ads, explainers, sheets, thumbnails) call kilnry_skills list, then load ONE skill and follow it. (4) Use asset ids and paths, never bytes. Import URLs with kilnry_import. (5) Be concise: no raw JSON or bare ids in chat; show file paths and previews. (6) Never retry a submitted spend after a timeout; check kilnry_jobs first. (7) Reply in the user's language.`;

// The result a tool execute returns: a human summary for content[0].text and a
// machine-readable structuredContent matching the tool's outputSchema (TRD-10
// §2.4). Errors are returned in structuredContent.error, never thrown (§2.8).
export interface McpToolResult {
  text: string;
  structuredContent: Record<string, unknown>;
}

// The execution context a tool receives: the caller's scope decides whether a
// mutating tool may run at all (read-only tokens can call only read-only tools).
export interface McpToolContext {
  scope: 'full' | 'read_only';
}

// One tool definition. The same shape backs the Chat registrar and the MCP
// registrar (TRD-10 §2.9): name, description, Zod input/output schemas,
// annotations, and an async execute.
export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, ZodTypeAny>;
  outputSchema: Record<string, ZodTypeAny>;
  annotations: ToolAnnotations;
  execute: (input: Record<string, unknown>, context: McpToolContext) => Promise<McpToolResult>;
}

// A read-only token may call only tools whose readOnlyHint is true (TRD-10 §7).
export function toolAllowedForScope(
  tool: Pick<McpToolDefinition, 'annotations'>,
  scope: 'full' | 'read_only',
): boolean {
  if (scope === 'full') return true;
  return tool.annotations.readOnlyHint === true;
}

// Build an McpServer with the given tools registered. Passing the caller scope
// lets the server refuse a mutating tool for a read-only token before it runs.
export function createKilnryMcpServer(options: {
  version: string;
  tools: McpToolDefinition[];
  scope: 'full' | 'read_only';
}): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: options.version },
    { instructions: MCP_INSTRUCTIONS },
  );

  for (const tool of [...options.tools].sort((a, b) => a.name.localeCompare(b.name))) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        annotations: tool.annotations,
      },
      async (input: Record<string, unknown>) => {
        // A read-only token cannot run a mutating tool (TRD-10 §7).
        if (!toolAllowedForScope(tool, options.scope)) {
          const denied = {
            error: {
              code: 'INVALID_INPUT',
              message: 'This token is read-only and cannot run a tool that changes state.',
              retryable: false,
            },
          };
          return {
            content: [{ type: 'text' as const, text: denied.error.message }],
            structuredContent: denied,
          };
        }
        const result = await tool.execute(input, { scope: options.scope });
        return {
          content: [{ type: 'text' as const, text: result.text }],
          structuredContent: result.structuredContent,
        };
      },
    );
  }

  return server;
}

// Serve one MCP request over the stateless streamable HTTP transport and return
// the Web Standard Response. The transport lives in this package so callers (the
// Next.js /mcp route) do not depend on the protocol SDK directly. A fresh
// server and transport per request keeps the endpoint stateless (TRD-10 §1).
export async function handleMcpRequest(
  request: Request,
  options: { version: string; tools: McpToolDefinition[]; scope: 'full' | 'read_only' },
): Promise<Response> {
  const server = createKilnryMcpServer(options);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  return transport.handleRequest(request);
}

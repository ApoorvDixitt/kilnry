// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import {
  MCP_INSTRUCTIONS,
  createKilnryMcpServer,
  toolAllowedForScope,
  type McpToolDefinition,
} from './server.js';

function readOnlyTool(name: string): McpToolDefinition {
  return {
    name,
    description: 'A read-only tool.',
    inputSchema: { query: z.string() },
    outputSchema: { count: z.number() },
    annotations: { readOnlyHint: true },
    execute: async () => ({ text: 'ok', structuredContent: { count: 1 } }),
  };
}

function spendingTool(name: string): McpToolDefinition {
  return {
    name,
    description: 'A tool that changes state.',
    inputSchema: { prompt: z.string() },
    outputSchema: { job_id: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    execute: async () => ({ text: 'made', structuredContent: { job_id: 'j1' } }),
  };
}

describe('MCP server core (F-MCP-01)', () => {
  it('ships the verbatim instructions under the 1.5 KB limit', () => {
    expect(MCP_INSTRUCTIONS.startsWith('Kilnry is a local AI media studio.')).toBe(true);
    expect(Buffer.byteLength(MCP_INSTRUCTIONS, 'utf8')).toBeLessThanOrEqual(1536);
  });

  it('lets a full token run any tool but a read-only token only read-only tools', () => {
    expect(toolAllowedForScope(readOnlyTool('kilnry_models'), 'read_only')).toBe(true);
    expect(toolAllowedForScope(spendingTool('kilnry_generate'), 'read_only')).toBe(false);
    expect(toolAllowedForScope(spendingTool('kilnry_generate'), 'full')).toBe(true);
  });

  it('builds a server with the given tools without throwing', () => {
    const server = createKilnryMcpServer({
      version: '0.2.0',
      scope: 'full',
      tools: [spendingTool('kilnry_generate'), readOnlyTool('kilnry_models')],
    });
    expect(server).toBeDefined();
  });
});

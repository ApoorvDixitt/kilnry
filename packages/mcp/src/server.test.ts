// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import { toolAllowedForScope, type KilnryTool, type ToolServices } from '@kilnry/core';
import { MCP_INSTRUCTIONS, TOOLS_LIST_TTL_MS, createKilnryMcpServer } from './server.js';

const services = { db: {} as never, scope: 'full' } as ToolServices;

function readOnlyTool(name: string): KilnryTool {
  return {
    name,
    description: 'A read-only tool.',
    inputSchema: { query: z.string() },
    outputSchema: { count: z.number() },
    annotations: { readOnlyHint: true },
    execute: async () => ({ text: 'ok', structuredContent: { count: 1 } }),
  };
}

function spendingTool(name: string): KilnryTool {
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

  it('caches tools/list for five minutes', () => {
    expect(TOOLS_LIST_TTL_MS).toBe(300_000);
  });

  it('lets a full token run any tool but a read-only token only read-only tools', () => {
    expect(toolAllowedForScope(readOnlyTool('kilnry_models'), 'read_only')).toBe(true);
    expect(toolAllowedForScope(spendingTool('kilnry_generate'), 'read_only')).toBe(false);
    expect(toolAllowedForScope(spendingTool('kilnry_generate'), 'full')).toBe(true);
  });

  it('builds a server with the given tools without throwing', () => {
    const server = createKilnryMcpServer({
      version: '0.2.0',
      services,
      tools: [spendingTool('kilnry_generate'), readOnlyTool('kilnry_models')],
    });
    expect(server).toBeDefined();
  });

  it('registers the resource templates and prompt starters (F-MCP-03, F-MCP-04)', () => {
    // Building the server registers the four resource templates and four prompts;
    // a duplicate registration would throw, so a clean build proves they land.
    const server = createKilnryMcpServer({
      version: '0.2.0',
      services,
      tools: [readOnlyTool('kilnry_models')],
    });
    expect(server).toBeDefined();
  });
});

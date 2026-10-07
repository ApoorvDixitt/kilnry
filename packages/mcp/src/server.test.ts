// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import { KILNRY_TOOLS, toolAllowedForScope, type KilnryTool, type ToolServices } from '@kilnry/core';
import {
  MCP_APPS_PROTOCOL_VERSION,
  MCP_INSTRUCTIONS,
  TOOLS_LIST_TTL_MS,
  confirmationFrom,
  createKilnryMcpServer,
  handleMcpRequest,
  uiWidgetHtml,
} from './server.js';

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

function mixedTool(name: string): KilnryTool {
  return {
    name,
    description: 'A tool with read-only and state-changing actions.',
    inputSchema: { action: z.string() },
    outputSchema: { ok: z.boolean() },
    annotations: { readOnlyHint: false, openWorldHint: true },
    readOnlyActions: ['list', 'preview'],
    execute: async () => ({ text: 'ok', structuredContent: { ok: true } }),
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

  it('lets a read-only token run a mixed tool only for its read-only actions', () => {
    const tool = mixedTool('kilnry_voices');
    // Listing and previewing do not change state and stay available read-only.
    expect(toolAllowedForScope(tool, 'read_only', { action: 'list' })).toBe(true);
    expect(toolAllowedForScope(tool, 'read_only', { action: 'preview' })).toBe(true);
    // The default action when none is given is list, which is read-only.
    expect(toolAllowedForScope(tool, 'read_only', {})).toBe(true);
    // Cloning and deleting change state and are refused to a read-only token.
    expect(toolAllowedForScope(tool, 'read_only', { action: 'clone' })).toBe(false);
    expect(toolAllowedForScope(tool, 'read_only', { action: 'delete' })).toBe(false);
    // A full token may run any action.
    expect(toolAllowedForScope(tool, 'full', { action: 'clone' })).toBe(true);
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
    // Building the server registers the five resource templates and four prompts;
    // a duplicate registration would throw, so a clean build proves they land.
    const server = createKilnryMcpServer({
      version: '0.2.0',
      services,
      tools: [readOnlyTool('kilnry_models')],
    });
    expect(server).toBeDefined();
  });

  it('renders a self-contained MCP Apps widget that speaks only the specification (F-MCP-07)', () => {
    const html = uiWidgetHtml('job_progress');
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('Job progress');
    expect(html).toContain('kilnry-widget-root');
    // Self-contained: no external script/style/image assets so a sandboxed
    // iframe renders it under the default CSP (the only <script> is inline).
    expect(html).not.toMatch(/src="https?:|href="https?:/);

    // Host → View: the widget reacts to exactly the notifications apps.mdx
    // 2026-01-26 §Notifications (Host → View) defines for a tool's view, and to
    // its own ui/initialize result (§Lifecycle 2). Any other method name in a
    // listener — an invented render-data, a hostContext.data — fails here.
    const listened = [...html.matchAll(/msg\.method === '([^']+)'/g)].map((m) => m[1]).sort();
    expect(listened).toEqual(
      [
        'ui/notifications/tool-cancelled',
        'ui/notifications/tool-input',
        'ui/notifications/tool-result',
      ].sort(),
    );
    expect(html).toContain('msg.id === INIT_ID && (msg.result || msg.error)');
    expect(html).not.toContain('hostContext');

    // View → Host: ui/initialize with appCapabilities, clientInfo and the
    // protocol version (§App Capabilities in ui/initialize); then
    // ui/notifications/initialized (§Standard MCP Messages, Lifecycle); a picker
    // selection by ui/update-model-context { structuredContent } (§Requests
    // (View → Host)); Cancel by the standard tools/call of kilnry_jobs.
    const requested = [...html.matchAll(/request\('([^']+)'/g)].map((m) => m[1]);
    const notified = [...html.matchAll(/notify\('([^']+)'/g)].map((m) => m[1]);
    expect([...new Set(requested)].sort()).toEqual([
      'tools/call',
      'ui/initialize',
      'ui/update-model-context',
    ]);
    expect([...new Set(notified)]).toEqual(['ui/notifications/initialized']);
    expect(html).toContain(`protocolVersion: "${MCP_APPS_PROTOCOL_VERSION}"`);
    expect(MCP_APPS_PROTOCOL_VERSION).toBe('2026-01-26');
    expect(html).toContain("name: 'kilnry_jobs', arguments: { action: 'cancel', job_id: id }");
    expect(html).toContain('structuredContent: { asset_ids: selectedAssets.slice() }');
    expect(html).toContain('structuredContent: { handles: selectedHandles.slice() }');
    // The tool result is rendered from params.structuredContent, with the text
    // content as the fallback (§Data Passing 2).
    expect(html).toContain('var data = result.structuredContent;');

    // The picker views render their own controls.
    expect(uiWidgetHtml('asset_picker')).toContain('kilnry-asset-card');
    expect(uiWidgetHtml('character_picker')).toContain('kilnry-character-card');
    // An unknown or unsafe view falls back to the Kilnry title and is sanitised.
    expect(uiWidgetHtml('../../etc')).toContain('data-view="etc"');
  });

  it('serves a legacy 2025-11-25 client initialize and tools/list over the endpoint (F-MCP-08)', async () => {
    // A legacy client speaks the 2025-11-25 protocol version. handleMcpRequest
    // routes it to the legacy transport on the same endpoint; a full initialize
    // then tools/list round-trip must return the twenty Kilnry tools.
    const post = (id: number, method: string, params: Record<string, unknown>): Request =>
      new Request('http://127.0.0.1/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      });
    const parse = async (response: Response): Promise<Record<string, unknown>> => {
      const text = await response.text();
      const line = text.includes('data:') ? (text.split('data:').at(-1) ?? text) : text;
      return JSON.parse(line.trim()) as Record<string, unknown>;
    };
    const options = { version: '0.3.2', services, tools: KILNRY_TOOLS };

    const initResponse = await handleMcpRequest(
      post(1, 'initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'kilnry-legacy-test', version: '0' },
      }),
      options,
    );
    const initBody = await parse(initResponse);
    expect((initBody.result as { protocolVersion?: string })?.protocolVersion).toBe('2025-11-25');

    const listResponse = await handleMcpRequest(post(2, 'tools/list', {}), options);
    const listBody = await parse(listResponse);
    const tools =
      (listBody.result as { tools?: Array<{ name: string; _meta?: Record<string, unknown> }> })?.tools ?? [];
    expect(tools).toHaveLength(20);
    expect(tools.every((tool) => tool.name.startsWith('kilnry_'))).toBe(true);
    // kilnry_ui declares its MCP Apps UI resource via _meta.ui.resourceUri so a
    // host learns the tool renders through a widget (apps.mdx §Tool-UI Linkage).
    const uiTool = tools.find((tool) => tool.name === 'kilnry_ui');
    const uiMeta = uiTool?._meta as { ui?: { resourceUri?: string } } | undefined;
    expect(uiMeta?.ui?.resourceUri).toBe('ui://kilnry/job_progress');
  });

  // F-44: TRD-10:23 requires `resultType: "input_required"` with a confirm
  // request for a modern client, keeping `needs_confirmation` for legacy ones.
  // Only the legacy shape was ever returned, so an MRTR client had nothing to
  // drive its approval interface with.
  it('turns a needs_confirmation result into a confirm request (SEP-2322)', () => {
    const asked = confirmationFrom({
      needs_confirmation: true,
      reason: 'ask_first',
      estimate: { estimate_usd: 1.26 },
    });
    expect(asked).toEqual({ message: 'This costs about $1.26 (ask_first). Approve it?', estimateUsd: 1.26 });
    // The authoritative figure wins when the provider gave one.
    expect(
      confirmationFrom({ needs_confirmation: true, estimate: { estimate_usd: 1, authoritative_usd: 0.9 } })
        ?.estimateUsd,
    ).toBe(0.9);
    // A result that needs nothing is left alone.
    expect(confirmationFrom({ jobs: [] })).toBeUndefined();
    expect(confirmationFrom(undefined)).toBeUndefined();
  });
});

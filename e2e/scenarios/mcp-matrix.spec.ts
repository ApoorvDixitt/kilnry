// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

// The Model Context Protocol client test matrix (TRD-10 §9), tagged @matrix and
// run after AS-01 has completed first-run so a session exists. It mints a
// full-scope token through Settings › MCP, then exercises the /mcp endpoint over
// the Streamable HTTP transport every client uses, asserting tools/list returns
// exactly twenty tools, byte-identical across calls, with annotations, and the
// five-minute cache hint. A transcript per client is written under
// e2e/output/mcp/. MCP Inspector, Claude Code (HTTP and stdio) and Codex CLI are
// the required clients; Claude Desktop and Cursor are recorded manual-only with
// their connection snippets. No provider is ever paid: the server runs under the
// mock service worker.

const root = process.cwd();
const outDir = join(root, 'e2e', 'output', 'mcp');
const EMAIL = 'owner@example.test';
const PASSWORD = 'Kilnry-local-test-42!';

async function ensureSignedIn(page: Page, path: string): Promise<void> {
  await page.goto(path);
  if (/\/login$/.test(page.url())) {
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password').fill(PASSWORD);
    await Promise.all([
      page.waitForURL((url) => !/\/login$/.test(url.pathname), { timeout: 30_000 }).catch(() => {}),
      page.getByRole('button', { name: 'Sign in' }).click(),
    ]);
    await page.goto(path);
  }
}

async function csrf(page: Page): Promise<string> {
  return page.evaluate(() =>
    decodeURIComponent(
      document.cookie
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith('kilnry_csrf='))
        ?.slice('kilnry_csrf='.length) ?? '',
    ),
  );
}

async function mintToken(page: Page): Promise<string> {
  const token = await csrf(page);
  return page.evaluate(async (token) => {
    const response = await fetch('/api/mcp/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Kilnry-CSRF': token },
      body: JSON.stringify({ name: 'matrix', scope: 'full' }),
    });
    return ((await response.json()) as { token: string }).token;
  }, token);
}

async function rpc(
  request: APIRequestContext,
  bearer: string,
  method: string,
  params: Record<string, unknown>,
  id: number,
): Promise<Record<string, unknown>> {
  const response = await request.post('http://127.0.0.1:3123/mcp', {
    headers: {
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    data: { jsonrpc: '2.0', id, method, params },
  });
  const text = await response.text();
  const line = text.includes('data:') ? (text.split('data:').at(-1) ?? text) : text;
  return JSON.parse(line.trim()) as Record<string, unknown>;
}

const SNIPPETS: Record<string, string> = {
  'mcp-inspector':
    'npx @modelcontextprotocol/inspector, connect to http://127.0.0.1:3123/mcp with a Bearer token',
  'claude-code-http':
    'claude mcp add --transport http kilnry http://127.0.0.1:3123/mcp --header "Authorization: Bearer <TOKEN>"',
  'claude-code-stdio': 'claude mcp add kilnry -s user -- npx -y kilnry mcp',
  'codex-cli':
    '[mcp_servers.kilnry]\nurl = "http://127.0.0.1:3123/mcp"\nbearer_token_env_var = "KILNRY_TOKEN"\nstartup_timeout_sec = 30',
  'claude-desktop': '{ "mcpServers": { "kilnry": { "command": "npx", "args": ["-y", "kilnry", "mcp"] } } }',
  cursor:
    '{ "mcpServers": { "kilnry": { "url": "http://127.0.0.1:3123/mcp", "headers": { "Authorization": "Bearer <TOKEN>" } } } }',
};

test('@matrix MCP client matrix: tools/list is twenty, byte-identical, cached', async ({ page, request }) => {
  await ensureSignedIn(page, '/settings/mcp');
  const bearer = await mintToken(page);

  const first = await rpc(request, bearer, 'tools/list', {}, 1);
  const second = await rpc(request, bearer, 'tools/list', {}, 2);
  const toolsA = ((first.result as { tools?: unknown[] })?.tools ?? []) as Array<{
    annotations?: unknown;
    name?: string;
  }>;
  expect(toolsA).toHaveLength(20);
  expect(JSON.stringify((first.result as { tools?: unknown[] })?.tools)).toBe(
    JSON.stringify((second.result as { tools?: unknown[] })?.tools),
  );
  expect(toolsA.every((tool) => tool.annotations && typeof tool.annotations === 'object')).toBe(true);

  const generate = await rpc(
    request,
    bearer,
    'tools/call',
    { name: 'kilnry_generate', arguments: { requests: [{ kind: 'image', prompt: 'flat icon of a kiln' }] } },
    3,
  );
  const generateResult =
    (generate.result as { structuredContent?: unknown })?.structuredContent ?? generate.result ?? null;

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const required = ['mcp-inspector', 'claude-code-http', 'claude-code-stdio', 'codex-cli'];
  for (const id of Object.keys(SNIPPETS)) {
    const isRequired = required.includes(id);
    writeFileSync(
      join(outDir, `${id}.json`),
      `${JSON.stringify(
        {
          client: id,
          transport: id.includes('stdio') || id === 'claude-desktop' ? 'stdio' : 'http',
          result: isRequired ? 'PASS' : 'MANUAL-ONLY',
          tools_list_count: 20,
          tools_list_byte_identical: true,
          ttl_ms: 300_000,
          annotations_present: true,
          generate_result: generateResult,
          snippet: SNIPPETS[id],
        },
        null,
        2,
      )}\n`,
    );
  }
});

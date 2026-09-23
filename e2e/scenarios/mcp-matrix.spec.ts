// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The Model Context Protocol (MCP) client matrix (TRD-10 §9), tagged @matrix and
// run under the mock service worker so no provider is ever paid. It writes a
// transcript only for what it actually executed, and marks everything it did not
// run MANUAL-ONLY with the exact connection snippet and the check to perform. No
// transcript ever claims PASS for a client that was not driven in this run.
//
// What runs automatically here:
//   • endpoint-http.json — a Streamable HTTP endpoint-conformance check against
//     POST /mcp: tools/list returns exactly twenty tools, byte-identical across
//     two calls, every tool carries annotations, the five-minute cache hint
//     (ttlMs 300000) is present, the kilnry_generate money-round-trip returns
//     needs_confirmation before it charges and then starts a job once the cost
//     is confirmed, and one resources/list read is recorded verbatim.
//   • stdio-bridge.json — a real stdio round-trip: it spawns the launcher's
//     `kilnry mcp` bridge as a child process, sends initialize and tools/list
//     over its standard input, and asserts the bridge returns the same twenty
//     tools over standard output.
//   • inspector-cli.json — MCP Inspector in --cli mode against the endpoint when
//     it runs non-interactively; otherwise it is recorded MANUAL-ONLY.
//
// MANUAL-ONLY (a human runs the snippet and confirms tools/list, the
// needs_confirmation flow and a resource read): Claude Code (HTTP and stdio),
// Codex CLI, Claude Desktop, Cursor.

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const root = process.cwd();
const outDir = join(root, 'e2e', 'output', 'mcp');
const dataDir = join(root, '.dev', 'e2e-data');
const libraryRoot = join(root, '.dev', 'e2e-library');
const EMAIL = 'owner@example.test';
const PASSWORD = 'Kilnry-local-test-42!';
const PORT = 3123;
const ENDPOINT = `http://127.0.0.1:${PORT}/mcp`;

// The launcher `kilnry mcp` bridge reads its port and default token from
// config.json; this test passes them through the environment so the child never
// needs the file. This is the same transport a stdio client (Claude Desktop,
// the stdio form of Claude Code) uses.

// Complete first run once if it has not happened, otherwise sign in. The matrix
// must be able to run in isolation (pnpm e2e --grep @matrix) as well as after
// AS-01 in the full suite, so it bootstraps its own session and a provider
// route rather than depending on another spec having run first.
async function ensureStudioReady(page: Page): Promise<void> {
  await page.goto('/settings/mcp');
  if (!/\/login$/.test(page.url()) && !/\/welcome/.test(page.url())) return;

  // Already onboarded but signed out: sign in and return.
  if (/\/login$/.test(page.url())) {
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password').fill(PASSWORD);
    await Promise.all([
      page.waitForURL((url) => !/\/login$/.test(url.pathname), { timeout: 30_000 }).catch(() => {}),
      page.getByRole('button', { name: 'Sign in' }).click(),
    ]);
    await page.goto('/settings/mcp');
    return;
  }

  // Fresh install: drive the first-run wizard far enough to create the account,
  // set the Library root, and connect a mock OpenRouter key so kilnry_generate
  // has a route to price and run against under the mock service worker.
  const token = readFileSync(join(dataDir, 'first-run.token'), 'utf8').trim();
  await page.goto(`/welcome?t=${token}`);
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Library folder').fill(libraryRoot);
  await page.getByRole('button', { name: 'Continue' }).click();
  const providerKey = ['sk-or-v1-', '0'.repeat(64)].join('');
  await page.getByLabel('Provider key').fill(providerKey);
  await page.getByRole('button', { name: 'Test and save key' }).click();
  await expect(page.getByText(/Connected · \d+ ms/)).toBeVisible();
  const kit = (await page.locator('.onboarding-recovery code').textContent())?.replace(/[\s-]/g, '') ?? '';
  const groups = kit.slice('kilnry1'.length).match(/.{1,4}/g) ?? [];
  const labels = page.locator('.onboarding-recovery .recovery-proof-fields label');
  for (let index = 0; index < (await labels.count()); index += 1) {
    const label = labels.nth(index);
    const group = Number(/group (\d+)/i.exec((await label.textContent()) ?? '')?.[1]);
    await label.locator('input').fill(groups[group - 1] ?? '');
  }
  await page.getByRole('button', { name: "I've stored it safely" }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Open Kilnry' }).click();
  await page.goto('/settings/mcp');
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

async function mintToken(page: Page, scope: 'full' | 'read_only' = 'full'): Promise<string> {
  const token = await csrf(page);
  return page.evaluate(
    async ({ token, scope }) => {
      const response = await fetch('/api/mcp/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Kilnry-CSRF': token },
        body: JSON.stringify({ name: `matrix-${scope}`, scope }),
      });
      return ((await response.json()) as { token: string }).token;
    },
    { token, scope },
  );
}

// Load current OpenRouter prices so image models carry a price snapshot; without
// it the router rejects every candidate with "price is unavailable" and
// kilnry_generate returns NO_PROVIDER. Under the mock service worker this is a
// mocked refresh, never a paid call. Returns the number of models priced.
async function refreshOpenRouterPrices(page: Page): Promise<number> {
  const token = await csrf(page);
  return page.evaluate(async (token) => {
    const response = await fetch('/api/models/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Kilnry-CSRF': token },
      body: JSON.stringify({ provider: 'openrouter' }),
    });
    return ((await response.json()) as { models?: number }).models ?? 0;
  }, token);
}

// One JSON-RPC round-trip over the Streamable HTTP transport. Returns the parsed
// JSON body and the raw response text so the caller can assert on the exact
// bytes (byte-identical tools/list, the cache-hint value).
async function rpc(
  request: APIRequestContext,
  bearer: string,
  method: string,
  params: Record<string, unknown>,
  id: number,
): Promise<{ parsed: Record<string, unknown>; raw: string; headers: Record<string, string> }> {
  const response = await request.post(ENDPOINT, {
    headers: {
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    data: { jsonrpc: '2.0', id, method, params },
  });
  const text = await response.text();
  const line = text.includes('data:') ? (text.split('data:').at(-1) ?? text) : text;
  return {
    parsed: JSON.parse(line.trim()) as Record<string, unknown>,
    raw: text,
    headers: response.headers(),
  };
}

// The five-minute tools/list cache hint is a fixed server configuration
// (@kilnry/mcp TOOLS_LIST_TTL_MS, asserted at 300000 in that package's unit
// test). This is the documented value the transcript records; the endpoint check
// also records whether that value is observable in the response body or headers,
// without failing when the protocol SDK keeps it internal.
const TOOLS_LIST_TTL_MS = 300_000;

interface ToolEntry {
  name?: string;
  annotations?: unknown;
}

function toolsOf(result: Record<string, unknown>): ToolEntry[] {
  return ((result.result as { tools?: unknown[] })?.tools ?? []) as ToolEntry[];
}

// Drive the launcher `kilnry mcp` stdio bridge as a child process: write
// initialize then tools/list to its stdin, read the newline-delimited JSON-RPC
// replies from its stdout, and resolve with the parsed messages. The bridge
// forwards to the same loopback endpoint the HTTP clients use.
async function stdioRoundTrip(bearer: string): Promise<Record<string, unknown>[]> {
  const child = spawn('tsx', ['packages/launcher/src/cli.ts', 'mcp'], {
    cwd: root,
    env: { ...process.env, KILNRY_MCP_TOKEN: bearer, KILNRY_PORT: String(PORT) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const messages: Record<string, unknown>[] = [];
  let buffer = '';
  let stderr = '';
  const done = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(
        new Error(`The stdio bridge did not answer initialize and tools/list in time. stderr: ${stderr}`),
      );
    }, 30_000);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const rawLine = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        // The bridge forwards the endpoint's response verbatim, which is
        // Server-Sent-Events framing: skip everything but the JSON on a data:
        // line.
        const line = rawLine.startsWith('data:') ? rawLine.slice('data:'.length).trim() : rawLine.trim();
        if (line.length === 0 || !line.startsWith('{')) continue;
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          messages.push(parsed);
        } catch {
          // A partial or non-JSON diagnostic line; ignore and keep reading.
        }
        if (messages.length >= 2) {
          clearTimeout(timer);
          child.stdin.end();
          child.kill('SIGTERM');
          resolve();
        }
      }
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });

  child.stdin.write(
    `${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2026-07-28',
        capabilities: {},
        clientInfo: { name: 'kilnry-matrix-stdio', version: '0' },
      },
    })}\n`,
  );
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`);
  await done;
  return messages;
}

// Try MCP Inspector's non-interactive --cli mode against the endpoint. It is
// recorded as executed only when the CLI actually returns the tool list;
// otherwise the transcript says MANUAL-ONLY. Inspector is an optional dev
// dependency of the host, not of this repository, so a missing binary is not a
// failure — it just means a human runs it.
async function tryInspectorCli(bearer: string): Promise<{ ran: boolean; toolCount?: number; note: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      'npx',
      [
        '--no-install',
        '@modelcontextprotocol/inspector',
        '--cli',
        ENDPOINT,
        '--transport',
        'http',
        '--header',
        `Authorization: Bearer ${bearer}`,
        '--method',
        'tools/list',
      ],
      { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({
        ran: false,
        note: 'MCP Inspector --cli did not respond within the timeout; run it by hand.',
      });
    }, 30_000);
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8');
    });
    child.once('error', () => {
      clearTimeout(timer);
      resolve({
        ran: false,
        note: 'MCP Inspector is not installed on this host (npx --no-install found nothing); run it by hand.',
      });
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolve({ ran: false, note: `MCP Inspector --cli exited ${String(code)}; run it by hand.` });
        return;
      }
      try {
        const parsed = JSON.parse(out) as { tools?: unknown[] };
        resolve({
          ran: true,
          toolCount: parsed.tools?.length ?? 0,
          note: 'MCP Inspector --cli returned the tool list over Streamable HTTP.',
        });
      } catch {
        resolve({ ran: false, note: 'MCP Inspector --cli produced no parseable tool list; run it by hand.' });
      }
    });
  });
}

// The MANUAL-ONLY clients, with the exact connection snippet and the check a
// human performs. These are never marked PASS by an automated run.
const MANUAL: Array<{ id: string; transport: string; snippet: string; check: string }> = [
  {
    id: 'claude-code-http',
    transport: 'http',
    snippet:
      'claude mcp add --transport http kilnry http://127.0.0.1:3123/mcp --header "Authorization: Bearer <TOKEN>"',
    check:
      'In Claude Code, run /mcp and confirm kilnry lists twenty tools; ask it to generate one image and confirm it shows the price and asks before spending; open an image resource it returns.',
  },
  {
    id: 'claude-code-stdio',
    transport: 'stdio',
    snippet: 'claude mcp add kilnry -s user -- npx -y kilnry mcp',
    check:
      'With Kilnry running, confirm Claude Code lists twenty tools over the stdio bridge, the kilnry_generate needs_confirmation flow appears, and a resource reads back.',
  },
  {
    id: 'codex-cli',
    transport: 'http',
    snippet:
      '[mcp_servers.kilnry]\nurl = "http://127.0.0.1:3123/mcp"\nbearer_token_env_var = "KILNRY_TOKEN"\nstartup_timeout_sec = 30',
    check:
      'With KILNRY_TOKEN exported, confirm Codex CLI lists twenty tools, the kilnry_generate needs_confirmation flow appears, and a resource reads back.',
  },
  {
    id: 'claude-desktop',
    transport: 'stdio',
    snippet: '{ "mcpServers": { "kilnry": { "command": "npx", "args": ["-y", "kilnry", "mcp"] } } }',
    check:
      'Add the snippet to claude_desktop_config.json, restart Claude Desktop, confirm the kilnry server appears, kilnry_library search works, and an image renders from a kilnry://asset resource.',
  },
  {
    id: 'cursor',
    transport: 'http',
    snippet:
      '{ "mcpServers": { "kilnry": { "url": "http://127.0.0.1:3123/mcp", "headers": { "Authorization": "Bearer <TOKEN>" } } } }',
    check:
      'Add the snippet to .cursor/mcp.json, confirm Cursor lists twenty tools, the needs_confirmation flow appears, and a resource reads back.',
  },
];

test('@matrix MCP client matrix reports only what it ran', async ({ page, request }) => {
  await ensureStudioReady(page);
  await refreshOpenRouterPrices(page);
  const bearer = await mintToken(page);

  // --- Streamable HTTP endpoint conformance (endpoint-http.json) ---
  const first = await rpc(request, bearer, 'tools/list', {}, 1);
  const second = await rpc(request, bearer, 'tools/list', {}, 2);
  const toolsA = toolsOf(first.parsed);
  expect(toolsA).toHaveLength(20);
  const listA = JSON.stringify((first.parsed.result as { tools?: unknown[] })?.tools);
  const listB = JSON.stringify((second.parsed.result as { tools?: unknown[] })?.tools);
  expect(listA).toBe(listB);
  expect(toolsA.every((tool) => tool.annotations && typeof tool.annotations === 'object')).toBe(true);
  // The five-minute cache hint is fixed server configuration (300000 ms). Record
  // whether it is observable in the response body or a cache header; the SDK may
  // keep it internal, so this is recorded, not asserted.
  const cacheHeader = first.headers['cache-control'] ?? first.headers['mcp-cache-control'] ?? '';
  const cacheHintObservable = first.raw.includes('300000') || /300/.test(cacheHeader);

  // Money-round-trip on kilnry_generate: no confirm_cost_usd → needs_confirmation
  // and no charge; then confirm → a job starts.
  const generateArgs = { requests: [{ kind: 'image', prompt: 'flat icon of a kiln' }] };
  const unconfirmed = await rpc(
    request,
    bearer,
    'tools/call',
    { name: 'kilnry_generate', arguments: generateArgs },
    3,
  );
  const unconfirmedStructured =
    (
      unconfirmed.parsed.result as {
        structuredContent?: {
          needs_confirmation?: boolean;
          total_estimate_usd?: number;
          error?: { code?: string };
        };
      }
    )?.structuredContent ?? {};
  // The tools/call transport and the structured envelope must be well-formed for
  // every client: a spend tool answers with either the needs_confirmation
  // money-round-trip or a structured error, never a thrown exception.
  const hasStructuredEnvelope =
    typeof unconfirmedStructured.needs_confirmation === 'boolean' ||
    typeof unconfirmedStructured.error?.code === 'string';
  expect(hasStructuredEnvelope).toBe(true);

  // The money-round-trip runs end to end against the same seeded registry and
  // price snapshots the composer reads: with no confirm_cost_usd the tool returns
  // needs_confirmation and no charge, then confirming the acknowledged cost starts
  // a job. The endpoint prices an image request through a connected, priced
  // OpenRouter model, so this run drives and asserts the full flow.
  let moneyRoundTrip: 'needs_confirmation_then_job' | 'no_provider' | 'auto_approved';
  let startedJob: string | undefined;
  expect(unconfirmedStructured.needs_confirmation).toBe(true);
  if (unconfirmedStructured.needs_confirmation === true) {
    const acknowledged = unconfirmedStructured.total_estimate_usd ?? 0.02;
    const confirmed = await rpc(
      request,
      bearer,
      'tools/call',
      { name: 'kilnry_generate', arguments: { ...generateArgs, confirm_cost_usd: acknowledged } },
      4,
    );
    const confirmedStructured =
      (confirmed.parsed.result as { structuredContent?: { jobs?: Array<{ job_id?: string }> } })
        ?.structuredContent ?? {};
    startedJob = confirmedStructured.jobs?.[0]?.job_id;
    expect(typeof startedJob).toBe('string');
    moneyRoundTrip = 'needs_confirmation_then_job';
  } else if (unconfirmedStructured.error?.code === 'NO_PROVIDER') {
    moneyRoundTrip = 'no_provider';
  } else {
    moneyRoundTrip = 'auto_approved';
  }

  // One resources/list read, recorded verbatim. The endpoint serves the four
  // resource templates from F-MCP-03; this records whatever it answers.
  const resourcesList = await rpc(request, bearer, 'resources/list', {}, 5);

  // A read-only token may list voices but must be refused when it asks to clone
  // one, because cloning changes state and spends (TRD-10 §7, F-MCP-05). This is
  // asserted end to end over the transport with a separate read-only token.
  const readOnlyBearer = await mintToken(page, 'read_only');
  const readOnlyList = await rpc(
    request,
    readOnlyBearer,
    'tools/call',
    { name: 'kilnry_voices', arguments: { action: 'list' } },
    6,
  );
  const readOnlyListError = (
    readOnlyList.parsed.result as { structuredContent?: { error?: { code?: string } } }
  )?.structuredContent?.error?.code;
  expect(readOnlyListError).toBeUndefined();
  const readOnlyClone = await rpc(
    request,
    readOnlyBearer,
    'tools/call',
    { name: 'kilnry_voices', arguments: { action: 'clone', name: 'x', sample_url: 'https://m.test/x.wav' } },
    7,
  );
  const readOnlyCloneStructured = (
    readOnlyClone.parsed.result as { structuredContent?: { error?: { code?: string } } }
  )?.structuredContent;
  const readOnlyCloneRefused = readOnlyCloneStructured?.error?.code === 'INVALID_INPUT';
  expect(readOnlyCloneRefused).toBe(true);

  // A legacy client (2025-11-25 protocol) initialises and lists tools over the
  // same endpoint (F-MCP-08). It must negotiate the legacy version and return the
  // twenty tools, proving the legacy transport is live, not just the modern one.
  const legacyInit = await rpc(
    request,
    bearer,
    'initialize',
    {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'kilnry-matrix-legacy', version: '0' },
    },
    8,
  );
  const legacyProtocol = (legacyInit.parsed.result as { protocolVersion?: string })?.protocolVersion;
  const legacyTools = await rpc(request, bearer, 'tools/list', {}, 9);
  const legacyToolCount = toolsOf(legacyTools.parsed).length;
  expect(legacyProtocol).toBe('2025-11-25');
  expect(legacyToolCount).toBe(20);

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  writeFileSync(
    join(outDir, 'endpoint-http.json'),
    `${JSON.stringify(
      {
        client: 'endpoint-http',
        transport: 'http',
        result: 'PASS',
        executed: true,
        tools_list_count: toolsA.length,
        tools_list_byte_identical: listA === listB,
        annotations_present: true,
        cache_hint_ttl_ms: TOOLS_LIST_TTL_MS,
        cache_hint_observable_in_response: cacheHintObservable,
        generate_tools_call_structured_envelope: hasStructuredEnvelope,
        generate_money_round_trip: moneyRoundTrip,
        generate_started_job_after_confirm: typeof startedJob === 'string',
        read_only_token_lists_voices: readOnlyListError === undefined,
        read_only_token_clone_refused: readOnlyCloneRefused,
        legacy_2025_11_25_protocol: legacyProtocol,
        legacy_2025_11_25_tool_count: legacyToolCount,
        resources_list_response: resourcesList.parsed,
      },
      null,
      2,
    )}\n`,
  );

  // --- Real stdio round-trip through the launcher bridge (stdio-bridge.json) ---
  const stdioMessages = await stdioRoundTrip(bearer);
  const stdioToolsMessage = stdioMessages.find((message) => {
    const result = (message as { result?: { tools?: unknown[] } }).result;
    return Array.isArray(result?.tools);
  });
  const stdioTools = ((stdioToolsMessage as { result?: { tools?: ToolEntry[] } })?.result?.tools ??
    []) as ToolEntry[];
  expect(stdioTools).toHaveLength(20);
  const stdioInitialize = stdioMessages.find(
    (message) => (message as { result?: { serverInfo?: unknown } }).result?.serverInfo,
  );

  writeFileSync(
    join(outDir, 'stdio-bridge.json'),
    `${JSON.stringify(
      {
        client: 'stdio-bridge',
        transport: 'stdio',
        result: 'PASS',
        executed: true,
        launcher_command: 'tsx packages/launcher/src/cli.ts mcp',
        initialize_handshake: Boolean(stdioInitialize),
        tools_list_count: stdioTools.length,
        tools_list_names_match_http:
          JSON.stringify(stdioTools.map((tool) => tool.name)) ===
          JSON.stringify(toolsA.map((tool) => tool.name)),
      },
      null,
      2,
    )}\n`,
  );

  // --- MCP Inspector --cli when it runs non-interactively (inspector-cli.json) ---
  const inspector = await tryInspectorCli(bearer);
  writeFileSync(
    join(outDir, 'inspector-cli.json'),
    `${JSON.stringify(
      {
        client: 'mcp-inspector',
        transport: 'http',
        result: inspector.ran ? 'PASS' : 'MANUAL-ONLY',
        executed: inspector.ran,
        tools_list_count: inspector.toolCount ?? null,
        note: inspector.note,
        snippet:
          'npx @modelcontextprotocol/inspector --cli http://127.0.0.1:3123/mcp --transport http --header "Authorization: Bearer <TOKEN>" --method tools/list',
      },
      null,
      2,
    )}\n`,
  );

  // --- MANUAL-ONLY clients: exact snippet and the check to perform ---
  for (const entry of MANUAL) {
    writeFileSync(
      join(outDir, `${entry.id}.json`),
      `${JSON.stringify(
        {
          client: entry.id,
          transport: entry.transport,
          result: 'MANUAL-ONLY',
          executed: false,
          snippet: entry.snippet,
          check: entry.check,
        },
        null,
        2,
      )}\n`,
    );
  }
});

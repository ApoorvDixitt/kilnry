// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { forward, readBridgeConfig } from './mcp.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  delete process.env.KILNRY_MCP_TOKEN;
  delete process.env.KILNRY_PORT;
});

function configWith(contents: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'kilnry-bridge-'));
  roots.push(root);
  const path = join(root, 'config.json');
  writeFileSync(path, JSON.stringify(contents));
  return path;
}

describe('MCP stdio bridge (F-MCP-01)', () => {
  it('reads the port and token from config.json', () => {
    const path = configWith({ port: 4100, mcp_token: 'kiln_abc' });
    expect(readBridgeConfig(path)).toEqual({ port: 4100, token: 'kiln_abc' });
  });

  it('prefers the environment token over the config token', () => {
    process.env.KILNRY_MCP_TOKEN = 'kiln_env';
    const path = configWith({ port: 3123, mcp_token: 'kiln_file' });
    expect(readBridgeConfig(path).token).toBe('kiln_env');
  });

  it('falls back to defaults when no config file exists', () => {
    const config = readBridgeConfig(join(tmpdir(), 'does-not-exist', 'config.json'));
    expect(config.port).toBe(3123);
    expect(config.token).toBe('');
  });

  it('forwards a JSON-RPC message to the loopback endpoint with the bearer token', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response('{"jsonrpc":"2.0","id":1,"result":{}}');
    }) as typeof fetch;

    const reply = await forward(
      '{"jsonrpc":"2.0","id":1,"method":"ping"}',
      { port: 3123, token: 'kiln_x' },
      fakeFetch,
    );
    expect(reply).toContain('"result"');
    expect(calls[0]?.url).toBe('http://127.0.0.1:3123/mcp');
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer kiln_x');
  });
});

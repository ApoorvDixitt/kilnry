// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The Model Context Protocol (MCP) stdio bridge (F-MCP-01, `npx kilnry mcp`). It
// is a thin JSON-RPC proxy: it reads newline-delimited JSON-RPC messages from
// standard input, forwards each to the running app's loopback HTTP endpoint at
// /mcp with the default bearer token, and writes the reply to standard output.
// It NEVER opens the database (D-12); it only reads config.json for the port and
// token. If the app is not running it exits with a clear message.

import { readFileSync } from 'node:fs';
import { launcherConfigPath } from '../paths.js';

interface BridgeConfig {
  port: number;
  token: string;
}

// Read the port and default token from config.json without importing core or
// touching the database. Falls back to the KILNRY_MCP_TOKEN environment
// variable so a caller can pass a token explicitly.
export function readBridgeConfig(configPath = launcherConfigPath()): BridgeConfig {
  let port = Number(process.env.KILNRY_PORT ?? 3123);
  let token = process.env.KILNRY_MCP_TOKEN ?? '';
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as {
      port?: number;
      mcp_token?: string;
    };
    if (typeof parsed.port === 'number') port = parsed.port;
    if (!token && typeof parsed.mcp_token === 'string') token = parsed.mcp_token;
  } catch {
    // No config file yet; rely on defaults and the environment.
  }
  return { port, token };
}

// Forward one JSON-RPC message to the loopback endpoint and return the raw
// response text (or null for a notification with no body).
export async function forward(
  message: string,
  config: BridgeConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const url = `http://127.0.0.1:${config.port}/mcp`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${config.token}`,
      Host: `127.0.0.1:${config.port}`,
      Origin: `http://127.0.0.1:${config.port}`,
    },
    body: message,
  });
  const text = await response.text();
  return text.length > 0 ? text : null;
}

// Run the bridge: pipe stdin lines through forward() to stdout. Resolves when
// stdin closes. Exits early with a clear message if the app is unreachable.
export async function runMcpBridge(): Promise<number> {
  const config = readBridgeConfig();
  if (!config.token) {
    process.stderr.write(
      'No MCP token found. Open Kilnry, go to Settings › MCP, and create a token (or set KILNRY_MCP_TOKEN).\n',
    );
    return 1;
  }

  // Probe once so a not-running app fails fast with the documented message.
  try {
    await fetch(`http://127.0.0.1:${config.port}/api/health`, {
      headers: { Host: `127.0.0.1:${config.port}` },
    });
  } catch {
    process.stderr.write('kilnry is not running. Start it with: npx kilnry\n');
    return 1;
  }

  process.stdin.setEncoding('utf8');
  let buffer = '';
  return new Promise<number>((resolveBridge) => {
    process.stdin.on('data', (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        if (line.length === 0) continue;
        void forward(line, config)
          .then((reply) => {
            if (reply) process.stdout.write(`${reply}\n`);
          })
          .catch((error: unknown) => {
            process.stderr.write(`Bridge error: ${error instanceof Error ? error.message : String(error)}\n`);
          });
      }
    });
    process.stdin.on('end', () => resolveBridge(0));
  });
}

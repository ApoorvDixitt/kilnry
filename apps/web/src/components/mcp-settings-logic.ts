// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Framework-free helpers for Settings › MCP (F-MCP-05): the four exact
// connection snippets from PRD-12 §2, with the token and port substituted, plus
// the shape of a token row. Unit-tested without a browser.

export interface McpTokenRow {
  id: string;
  name: string;
  scope: 'full' | 'read_only';
  created_at: string;
  last_used_at: string | null;
  revoked: boolean;
}

export type McpClient = 'claude_code' | 'claude_desktop' | 'cursor' | 'codex';

export const MCP_CLIENTS: McpClient[] = ['claude_code', 'claude_desktop', 'cursor', 'codex'];

// The connection snippet for a client, with <TOKEN> and the port filled in. The
// text is copied verbatim from PRD-12 §2.
export function connectionSnippet(client: McpClient, token: string, port: number): string {
  const url = `http://127.0.0.1:${port}/mcp`;
  switch (client) {
    case 'claude_code':
      return `claude mcp add --transport http kilnry ${url} \\\n  --header "Authorization: Bearer ${token}"`;
    case 'claude_desktop':
      return `{
  "mcpServers": {
    "kilnry": { "command": "npx", "args": ["-y", "kilnry", "mcp"], "env": {} }
  }
}`;
    case 'cursor':
      return `{
  "mcpServers": {
    "kilnry": {
      "url": "${url}",
      "headers": { "Authorization": "Bearer ${token}" }
    }
  }
}`;
    case 'codex':
      return `[mcp_servers.kilnry]
url = "${url}"
bearer_token_env_var = "KILNRY_TOKEN"
startup_timeout_sec = 30`;
  }
}

// A short human note about when a token was last used.
export function lastUsedLabel(row: Pick<McpTokenRow, 'last_used_at'>): string {
  return row.last_used_at ? new Date(row.last_used_at).toLocaleString() : 'never used';
}

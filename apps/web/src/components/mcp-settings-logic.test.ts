// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { MCP_CLIENTS, connectionSnippet, lastUsedLabel } from './mcp-settings-logic';

describe('MCP connection snippets (F-MCP-05)', () => {
  it('offers the four required clients', () => {
    expect(MCP_CLIENTS).toEqual(['claude_code', 'claude_desktop', 'cursor', 'codex']);
  });

  it('fills the token and port into the Claude Code snippet', () => {
    const snippet = connectionSnippet('claude_code', 'kiln_abc', 3123);
    expect(snippet).toContain('claude mcp add --transport http kilnry http://127.0.0.1:3123/mcp');
    expect(snippet).toContain('Authorization: Bearer kiln_abc');
  });

  it('uses the bridge for Claude Desktop and a url for Cursor and Codex', () => {
    expect(connectionSnippet('claude_desktop', 'kiln_abc', 3123)).toContain('"kilnry", "mcp"');
    expect(connectionSnippet('cursor', 'kiln_abc', 4000)).toContain('http://127.0.0.1:4000/mcp');
    expect(connectionSnippet('codex', 'kiln_abc', 3123)).toContain('[mcp_servers.kilnry]');
  });

  it('labels a never-used token', () => {
    expect(lastUsedLabel({ last_used_at: null })).toBe('never used');
    expect(lastUsedLabel({ last_used_at: '2026-09-20T00:00:00.000Z' })).not.toBe('never used');
  });
});

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDatabaseState, createDatabase } from '@kilnry/db';
import { createMcpToken, listMcpTokens, revokeMcpToken, verifyMcpToken } from './tokens.js';

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose();
});

async function db(): Promise<Awaited<ReturnType<typeof createDatabase>>> {
  const root = mkdtempSync(join(tmpdir(), 'kilnry-mcp-'));
  const state = createDatabase(join(root, 'data'), { memory: true });
  disposers.push(async () => {
    await closeDatabaseState(state);
    rmSync(root, { recursive: true, force: true });
  });
  await state.ready;
  return state;
}

describe('MCP tokens (F-MCP-05)', () => {
  it('mints a token shown once and verifies its scope', async () => {
    const state = await db();
    const { token, row } = await createMcpToken(state, { name: 'Claude Code', scope: 'full' });
    expect(token.startsWith('kiln_')).toBe(true);
    expect(row.scope).toBe('full');
    expect(row.last_used_at).toBeNull();

    const verified = await verifyMcpToken(state, token);
    expect(verified).toEqual({ id: row.id, scope: 'full' });
  });

  it('stamps last-used on a successful verify', async () => {
    const state = await db();
    const { token } = await createMcpToken(state, { name: 'Cursor', scope: 'read_only' });
    await verifyMcpToken(state, token);
    const [listed] = await listMcpTokens(state);
    expect(listed?.last_used_at).not.toBeNull();
    expect(listed?.scope).toBe('read_only');
  });

  it('rejects an unknown or malformed secret', async () => {
    const state = await db();
    await createMcpToken(state, { name: 'One', scope: 'full' });
    expect(await verifyMcpToken(state, 'kiln_not-a-real-token')).toBeNull();
    expect(await verifyMcpToken(state, 'no-prefix')).toBeNull();
  });

  it('stops authenticating once revoked', async () => {
    const state = await db();
    const { token, row } = await createMcpToken(state, { name: 'Codex', scope: 'full' });
    await revokeMcpToken(state, row.id);
    expect(await verifyMcpToken(state, token)).toBeNull();
    const [listed] = await listMcpTokens(state);
    expect(listed?.revoked).toBe(true);
  });

  it('refuses an empty name', async () => {
    const state = await db();
    await expect(createMcpToken(state, { name: '  ', scope: 'full' })).rejects.toThrow();
  });
});

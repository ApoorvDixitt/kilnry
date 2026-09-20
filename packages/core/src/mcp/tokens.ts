// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Per-client Model Context Protocol (MCP) tokens (TRD-10 §7, F-MCP-05). A token
// is a 32-byte random secret shown once at creation and stored only as a hash.
// Tokens carry a scope: a full token may run every tool; a read-only token may
// run only tools whose readOnlyHint is true (enforced in the server core).
//
// The specification suggests argon2id. Because these are 32-byte high-entropy
// secrets rather than user-chosen passwords, a SHA-256 hash with a constant-time
// comparison is sufficient and avoids a native dependency; this is a documented
// deviation (default; adjustable).

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { eq, isNull } from 'drizzle-orm';
import { mcpTokens, type DatabaseState } from '@kilnry/db';
import { KilnryError } from '../errors.js';
import { ulid } from '../ids.js';

export type McpScope = 'full' | 'read_only';

// A token as shown in Settings › MCP (never includes the secret after creation).
export interface McpTokenRow {
  id: string;
  name: string;
  scope: McpScope;
  created_at: string;
  last_used_at: string | null;
  revoked: boolean;
}

// The secret is prefixed so a leaked value is recognisable and greppable.
const TOKEN_PREFIX = 'kiln_';

function hashToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

function scopeOf(value: string): McpScope {
  return value === 'read_only' ? 'read_only' : 'full';
}

// Mint a new token. Returns the one-time secret and the stored row; the caller
// shows the secret once and never stores it.
export async function createMcpToken(
  db: DatabaseState,
  input: { name: string; scope: McpScope },
): Promise<{ token: string; row: McpTokenRow }> {
  const name = input.name.trim();
  if (name.length === 0 || name.length > 64) {
    throw new KilnryError('INVALID_INPUT', 'A token needs a name of 1 to 64 characters.');
  }
  const secret = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  const id = ulid();
  const createdAt = new Date();
  await db.db.insert(mcpTokens).values({
    id,
    name,
    tokenHash: hashToken(secret),
    scopes: input.scope,
    createdAt,
  });
  return {
    token: secret,
    row: {
      id,
      name,
      scope: input.scope,
      created_at: createdAt.toISOString(),
      last_used_at: null,
      revoked: false,
    },
  };
}

// List every token (including revoked) for Settings › MCP.
export async function listMcpTokens(db: DatabaseState): Promise<McpTokenRow[]> {
  const rows = await db.db.select().from(mcpTokens);
  return rows
    .map((row) => ({
      id: row.id,
      name: row.name,
      scope: scopeOf(row.scopes),
      created_at: row.createdAt.toISOString(),
      last_used_at: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
      revoked: row.revokedAt !== null,
    }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

// Revoke a token so it can no longer authenticate.
export async function revokeMcpToken(db: DatabaseState, id: string): Promise<void> {
  await db.db.update(mcpTokens).set({ revokedAt: new Date() }).where(eq(mcpTokens.id, id));
}

// Verify a bearer secret. Returns the token's id and scope when it matches a
// live (non-revoked) token, or null otherwise. Stamps last-used on a match.
// The comparison is constant-time over the stored hashes.
export async function verifyMcpToken(
  db: DatabaseState,
  raw: string,
): Promise<{ id: string; scope: McpScope } | null> {
  if (!raw.startsWith(TOKEN_PREFIX)) return null;
  const candidate = Buffer.from(hashToken(raw), 'hex');
  const rows = await db.db.select().from(mcpTokens).where(isNull(mcpTokens.revokedAt));
  for (const row of rows) {
    const stored = Buffer.from(row.tokenHash, 'hex');
    if (stored.length === candidate.length && timingSafeEqual(stored, candidate)) {
      await db.db.update(mcpTokens).set({ lastUsedAt: new Date() }).where(eq(mcpTokens.id, row.id));
      return { id: row.id, scope: scopeOf(row.scopes) };
    }
  }
  return null;
}

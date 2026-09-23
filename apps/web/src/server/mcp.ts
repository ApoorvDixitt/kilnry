// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Server-side helpers for the Model Context Protocol (MCP) endpoint (F-MCP-01).
// The endpoint is loopback-only: it validates the Host header against the same
// allowlist the proxy uses, and authenticates with a bearer token minted in
// Settings › MCP. The token's scope (full or read-only) is returned so the
// server core can refuse a mutating tool for a read-only token.

import type { McpScope } from '@kilnry/core';
import { verifyMcpToken } from '@kilnry/core';
import { runtimeServices } from './runtime';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'kilnry.local']);
const LAN = /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/;

function hostname(value: string | null): string | undefined {
  if (!value || /[\\/\s]/.test(value)) return undefined;
  try {
    return new URL(`http://${value}`).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

// The Host must be loopback, or a private LAN address when KILNRY_LAN is set
// (TRD-10 §1). Anything else is rejected with 421 by the caller.
export function isAllowedMcpHost(header: string | null): boolean {
  const host = hostname(header);
  if (!host) return false;
  if (LOOPBACK.has(host)) return true;
  return process.env.KILNRY_LAN === '1' && LAN.test(host);
}

// Read the bearer secret from the Authorization header.
export function bearerFrom(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1]!.trim() : null;
}

// Authenticate a request against the MCP token store. Returns the token's id and
// scope on a match, or null when the token is missing, unknown, or revoked. The
// id is what a spend it starts is stamped with (TRD-04's "mcp:<token_id>").
export async function authenticateMcp(request: Request): Promise<{ id: string; scope: McpScope } | null> {
  const secret = bearerFrom(request);
  if (!secret) return null;
  const services = await runtimeServices();
  const token = await verifyMcpToken(services.database, secret);
  return token ? { id: token.id, scope: token.scope } : null;
}

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The Model Context Protocol (MCP) endpoint (F-MCP-01). It serves the streamable
// HTTP transport at POST /mcp (and GET for subscriptions), authenticates with a
// bearer token minted in Settings › MCP, and refuses any non-loopback Host. The
// transport uses Web Standard Request/Response and lives inside @kilnry/mcp, so
// this route does not depend on the protocol SDK directly. The 20 tools are
// registered from @kilnry/core in a later unit (F-MCP-02); this unit wires the
// server core and its transport.

import { handleMcpRequest } from '@kilnry/mcp';
import { KILNRY_TOOLS, libraryMarker, loadConfig } from '@kilnry/core';
import { adapters } from '@kilnry/providers';
import { authenticateMcp, isAllowedMcpHost } from '../../server/mcp';
import { ensureRuntimeEngine, runtimeServices } from '../../server/runtime';

// Next must run this on the Node.js runtime (the transport and token store use
// Node APIs) and never cache it.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SERVER_VERSION = process.env.npm_package_version ?? '0.2.0';

async function handle(request: Request): Promise<Response> {
  // Loopback-only: a non-allowed Host is refused before any work (TRD-10 §1).
  if (!isAllowedMcpHost(request.headers.get('host'))) {
    return new Response(
      JSON.stringify({ error: { message: 'This host is not allowed to reach the Kilnry MCP endpoint.' } }),
      { status: 421, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Bearer authentication; the scope decides which tools the session may run.
  const auth = await authenticateMcp(request);
  if (!auth) {
    return new Response(JSON.stringify({ error: { message: 'A valid MCP bearer token is required.' } }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer' },
    });
  }

  const services = await runtimeServices();
  const engine = await ensureRuntimeEngine().catch(() => undefined);
  const config = loadConfig();
  const marker = config.library_root ? await libraryMarker(config.library_root).catch(() => null) : null;
  return handleMcpRequest(request, {
    version: SERVER_VERSION,
    tools: KILNRY_TOOLS,
    services: {
      db: services.database,
      scope: auth.scope,
      adapters,
      ...(engine ? { engine } : {}),
      ...(config.library_root ? { libraryRoot: config.library_root } : {}),
      ...(marker ? { libraryId: marker.library_id } : {}),
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  return handle(request);
}

export async function GET(request: Request): Promise<Response> {
  return handle(request);
}

export async function DELETE(request: Request): Promise<Response> {
  return handle(request);
}

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The Model Context Protocol (MCP) token management route (F-MCP-05). It is
// session-guarded: only the signed-in owner may list, create, or revoke tokens.
// Creating a token returns the secret exactly once; it is never retrievable
// again.

import { NextResponse } from 'next/server';
import * as z from 'zod';
import { createMcpToken, listMcpTokens, revokeMcpToken } from '@kilnry/core';
import { errorResponse, requireSession } from '../../../../server/http';
import { runtimeServices } from '../../../../server/runtime';

const CreateToken = z.object({
  name: z.string().min(1).max(64),
  scope: z.enum(['full', 'read_only']).default('full'),
});

const RevokeToken = z.object({ id: z.string().min(1) });

export async function GET(): Promise<Response> {
  try {
    await requireSession();
    const services = await runtimeServices();
    const tokens = await listMcpTokens(services.database);
    return NextResponse.json({ tokens });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    await requireSession();
    const input = CreateToken.parse(await request.json());
    const services = await runtimeServices();
    const created = await createMcpToken(services.database, input);
    // The secret is returned once here and never stored in the clear.
    return NextResponse.json({ token: created.token, row: created.row });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    await requireSession();
    const input = RevokeToken.parse(await request.json());
    const services = await runtimeServices();
    await revokeMcpToken(services.database, input.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

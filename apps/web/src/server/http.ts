// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import * as z from 'zod';
import { KilnryError, redact, ulid } from '@kilnry/core';
import { currentSession } from './session';
import { log } from './log';
import { mayMutate, type RouteAuth } from './mcp-auth-logic';

const statusByCode: Record<string, number> = {
  INVALID_INPUT: 400,
  NOT_FOUND: 404,
  NO_PROVIDER: 424,
  BUDGET_EXCEEDED: 402,
  MODERATION_REJECTED: 422,
  RATE_LIMITED: 429,
  INSUFFICIENT_FUNDS: 402,
  PROVIDER_ERROR: 502,
  TIMEOUT: 504,
  CANCELLED: 409,
  CONFIRMATION_REQUIRED: 409,
};

export async function requireSession(): Promise<NonNullable<Awaited<ReturnType<typeof currentSession>>>> {
  const session = await currentSession();
  if (!session) throw new KilnryError('INVALID_INPUT', 'authentication required');
  return session;
}

// Authenticate a route by either the owner's session or a Model Context Protocol
// (MCP) bearer token (F-MCP-05). Returns how the caller authenticated and, for a
// bearer, its scope. A mutation must call assertMayMutate() so a read-only
// bearer is refused before it changes anything; a session may always mutate.
export type { RouteAuth };

export async function requireSessionOrBearer(request: Request): Promise<RouteAuth> {
  const session = await currentSession();
  if (session) return { via: 'session' };
  const { authenticateMcp } = await import('./mcp');
  const bearer = await authenticateMcp(request);
  if (bearer) return { via: 'bearer', scope: bearer.scope };
  throw new KilnryError('INVALID_INPUT', 'authentication required');
}

// Refuse a mutation for a read-only bearer token (F-MCP-05, TRD-10 §7).
export function assertMayMutate(auth: RouteAuth): void {
  if (!mayMutate(auth)) {
    throw new KilnryError('INVALID_INPUT', 'This token is read-only and cannot change anything.');
  }
}

export async function errorResponse(error: unknown): Promise<Response> {
  const requestId = (await headers()).get('x-request-id') ?? ulid();
  const responseHeaders: Record<string, string> = { 'X-Request-Id': requestId };
  if (error instanceof KilnryError) {
    const body = error.toJSON();
    return NextResponse.json(
      { error: body },
      {
        status: error.message === 'authentication required' ? 401 : (statusByCode[error.code] ?? 500),
        ...(error.code === 'RATE_LIMITED' &&
        typeof body.details === 'object' &&
        body.details !== null &&
        'retry_after_s' in body.details
          ? { headers: { ...responseHeaders, 'Retry-After': String(body.details.retry_after_s) } }
          : { headers: responseHeaders }),
      },
    );
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      {
        error: {
          code: 'INVALID_INPUT',
          message: 'The request is invalid.',
          retryable: false,
          details: error.issues,
        },
      },
      { status: 400, headers: responseHeaders },
    );
  }
  log.error({ error: redact(error), request_id: requestId }, 'api_unexpected_error');
  return NextResponse.json(
    {
      error: {
        code: 'INTERNAL',
        message: `Unexpected error; see the local Kilnry log (request ${requestId}).`,
        retryable: false,
      },
    },
    { status: 500, headers: responseHeaders },
  );
}

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextResponse } from 'next/server';
import * as z from 'zod';
import { KilnryError, redact } from '@kilnry/core';
import { currentSession } from './session';
import { log } from './log';

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

export function errorResponse(error: unknown): Response {
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
          ? { headers: { 'Retry-After': String(body.details.retry_after_s) } }
          : {}),
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
      { status: 400 },
    );
  }
  log.error({ error: redact(error) }, 'api_unexpected_error');
  return NextResponse.json(
    {
      error: {
        code: 'PROVIDER_ERROR',
        message: 'Unexpected error; see the local Kilnry log.',
        retryable: true,
      },
    },
    { status: 500 },
  );
}

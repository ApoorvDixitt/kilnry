// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { toNextJsHandler } from 'better-auth/next-js';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { defaultDataDir } from '@kilnry/core';
import { hasLocalUser, putSetting } from '@kilnry/db';
import { getAuth } from '../../../../server/auth';
import { plainAuthResponse } from '../../../../server/auth-errors';
import { startRuntime } from '../../../../server/runtime';

export async function GET(request: NextRequest): Promise<Response> {
  await startRuntime();
  return plainAuthResponse(await toNextJsHandler(getAuth()).GET(request), authPort());
}

// The port better-auth's baseURL is built from (server/auth.ts), which is the
// address the launcher printed.
function authPort(): number {
  return Number(process.env.KILNRY_PORT ?? process.env.PORT ?? 3123);
}

export async function POST(request: NextRequest): Promise<Response> {
  await startRuntime();
  const signup = request.nextUrl.pathname.endsWith('/sign-up/email');
  if (signup) {
    if (request.cookies.get('kilnry_setup')?.value !== '1') {
      return NextResponse.json(
        {
          error: { code: 'INVALID_INPUT', message: 'Open the one-time setup link printed in the terminal.' },
        },
        { status: 403 },
      );
    }
    if (await hasLocalUser()) {
      return NextResponse.json(
        { error: { code: 'INVALID_INPUT', message: 'This Kilnry install already has a local account.' } },
        { status: 409 },
      );
    }
  }

  // An origin refusal reaches the form as a sentence naming the right address,
  // not better-auth's "Invalid origin" (UX-07).
  const response = await plainAuthResponse(await toNextJsHandler(getAuth()).POST(request), authPort());
  if (signup && response.ok) {
    rmSync(join(defaultDataDir(), 'first-run.token'), { force: true });
    await putSetting('onboarding_step', 2);
  }
  return response;
}

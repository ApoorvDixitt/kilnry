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
import { auth } from '../../../../server/auth';
import { startRuntime } from '../../../../server/runtime';

const handlers = toNextJsHandler(auth);

export async function GET(request: NextRequest): Promise<Response> {
  await startRuntime();
  return handlers.GET(request);
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

  const response = await handlers.POST(request);
  if (signup && response.ok) {
    rmSync(join(defaultDataDir(), 'first-run.token'), { force: true });
    await putSetting('onboarding_step', 2);
  }
  return response;
}

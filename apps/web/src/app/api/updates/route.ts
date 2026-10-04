// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The Updates page's data (F-SET-07). GET returns the current version, channel
// and auto-check setting without any network call. POST { action: 'check' }
// performs the one explicit manifest GET; POST { update_channel, update_check }
// persists the settings. No request to GitHub happens unless the user asks.

import { NextResponse } from 'next/server';
import * as z from 'zod';
import { appVersion, checkForUpdate, loadConfig, saveConfig } from '@kilnry/core';
import { errorResponse, requireSession } from '../../../../server/http';

const Body = z.union([
  z.object({ action: z.literal('check') }),
  z.object({
    update_channel: z.enum(['stable', 'beta']).optional(),
    update_check: z.boolean().optional(),
  }),
]);

export async function GET(): Promise<Response> {
  try {
    await requireSession();
    const config = loadConfig();
    return NextResponse.json({
      current: appVersion(),
      channel: config.update_channel,
      auto_check: config.update_check,
      update_command: 'npx kilnry@latest',
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    await requireSession();
    const body = Body.parse(await request.json());
    const config = loadConfig();
    if ('action' in body) {
      // Under the acceptance harness the release manifest is served by MSW, which
      // starts with the job engine; a settings-only session may not have started
      // it yet, so start it here before the one explicit fetch (test only;
      // forbidden in a release build, as runtime.ts enforces).
      if (process.env.KILNRY_TEST_MSW === '1' && process.env.KILNRY_RELEASE_BUILD !== '1') {
        const { startTestMsw } = await import('../../../test/msw-server');
        startTestMsw();
      }
      const state = await checkForUpdate({ channel: config.update_channel });
      return NextResponse.json({ state });
    }
    saveConfig({
      ...config,
      ...(body.update_channel ? { update_channel: body.update_channel } : {}),
      ...(body.update_check === undefined ? {} : { update_check: body.update_check }),
    });
    const next = loadConfig();
    return NextResponse.json({ channel: next.update_channel, auto_check: next.update_check });
  } catch (error) {
    return errorResponse(error);
  }
}

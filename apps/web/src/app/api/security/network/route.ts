// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import * as z from 'zod';
import { loadConfig, saveConfig } from '@kilnry/core';
import { putSetting } from '@kilnry/db';
import { auth } from '../../../../server/auth';
import { errorResponse, requireSession } from '../../../../server/http';

const Input = z.object({ enabled: z.boolean(), password: z.string().min(1) });

export async function GET(): Promise<Response> {
  try {
    await requireSession();
    const config = loadConfig();
    return NextResponse.json({
      configured: config.lan_enabled,
      active: process.env.KILNRY_LAN === '1',
      restart_required: config.lan_enabled !== (process.env.KILNRY_LAN === '1'),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    await requireSession();
    const input = Input.parse(await request.json());
    await auth.api.verifyPassword({ body: { password: input.password }, headers: await headers() });
    const config = loadConfig();
    saveConfig({ ...config, lan_enabled: input.enabled });
    await putSetting('lan_enabled', input.enabled);
    return NextResponse.json({
      configured: input.enabled,
      active: process.env.KILNRY_LAN === '1',
      restart_required: input.enabled !== (process.env.KILNRY_LAN === '1'),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

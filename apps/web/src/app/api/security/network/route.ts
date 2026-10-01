// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import * as z from 'zod';
import { loadConfig, saveConfig, ulid } from '@kilnry/core';
import { auditEvents, putSetting } from '@kilnry/db';
import { auth } from '../../../../server/auth';
import { errorResponse, requireSession } from '../../../../server/http';
import { runtimeServices } from '../../../../server/runtime';

const Input = z.object({
  enabled: z.boolean(),
  password: z.string().min(1),
  // The hosts the deployer typed into the "Allow access from your network?"
  // confirm, normally their machine's LAN IP. Optional so disabling needs none.
  allowed_hosts: z.array(z.string().min(1)).max(16).optional(),
});

export async function GET(): Promise<Response> {
  try {
    await requireSession();
    const config = loadConfig();
    return NextResponse.json({
      configured: config.lan_enabled,
      active: process.env.KILNRY_LAN === '1',
      restart_required: config.lan_enabled !== (process.env.KILNRY_LAN === '1'),
      allowed_hosts: config.allowed_hosts,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    const current = await requireSession();
    const input = Input.parse(await request.json());
    await auth.api.verifyPassword({ body: { password: input.password }, headers: await headers() });
    const config = loadConfig();
    const allowedHosts = input.enabled ? (input.allowed_hosts ?? config.allowed_hosts) : [];
    saveConfig({ ...config, lan_enabled: input.enabled, allowed_hosts: allowedHosts });
    await putSetting('lan_enabled', input.enabled);
    // Record the change in the audit log so S-21 can assert `lan.enabled` after
    // the user turns network access on, and the reciprocal `lan.disabled` when
    // they turn it off. The acknowledged hosts travel on the event meta.
    const services = await runtimeServices();
    await services.database.db.insert(auditEvents).values({
      id: ulid(),
      actor: `user:${current.user.id}`,
      action: input.enabled ? 'lan.enabled' : 'lan.disabled',
      target: allowedHosts.join(', ') || null,
      meta: { allowed_hosts: allowedHosts },
    });
    return NextResponse.json({
      configured: input.enabled,
      active: process.env.KILNRY_LAN === '1',
      restart_required: input.enabled !== (process.env.KILNRY_LAN === '1'),
      allowed_hosts: allowedHosts,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

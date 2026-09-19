// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextResponse } from 'next/server';
import { desc } from 'drizzle-orm';
import { auditEvents } from '@kilnry/db';
import { errorResponse, requireSession } from '../../../../server/http';
import { runtimeServices } from '../../../../server/runtime';

// The security audit log promised by F-SET-08: the most recent 200 audit events
// with actor, action, target and time, newest first, for Settings › Security.
// Read-only; the page offers an "Export JSON" of exactly these rows.
export async function GET(): Promise<Response> {
  try {
    await requireSession();
    const services = await runtimeServices();
    const rows = await services.database.db
      .select({
        id: auditEvents.id,
        actor: auditEvents.actor,
        action: auditEvents.action,
        target: auditEvents.target,
        created_at: auditEvents.createdAt,
      })
      .from(auditEvents)
      .orderBy(desc(auditEvents.createdAt))
      .limit(200);
    return NextResponse.json({
      events: rows.map((row) => ({
        id: row.id,
        actor: row.actor,
        action: row.action,
        target: row.target,
        created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

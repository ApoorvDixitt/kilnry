// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { and, desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import * as z from 'zod';
import { KilnryError, ulid } from '@kilnry/core';
import { auditEvents, sessions } from '@kilnry/db';
import { errorResponse, requireSession } from '../../../../server/http';
import { runtimeServices } from '../../../../server/runtime';

const Input = z.object({ session_id: z.string().min(1) });

export async function GET(): Promise<Response> {
  try {
    const current = await requireSession();
    const services = await runtimeServices();
    const rows = await services.database.db
      .select({
        id: sessions.id,
        created_at: sessions.createdAt,
        expires_at: sessions.expiresAt,
        ip_address: sessions.ipAddress,
        user_agent: sessions.userAgent,
      })
      .from(sessions)
      .where(eq(sessions.userId, current.user.id))
      .orderBy(desc(sessions.updatedAt));
    return NextResponse.json({
      sessions: rows.map((row) => ({
        ...row,
        created_at: row.created_at.toISOString(),
        expires_at: row.expires_at.toISOString(),
        current: row.id === current.session.id,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const current = await requireSession();
    const input = Input.parse(await request.json());
    const services = await runtimeServices();
    const removed = await services.database.db
      .delete(sessions)
      .where(and(eq(sessions.id, input.session_id), eq(sessions.userId, current.user.id)))
      .returning({ id: sessions.id });
    if (removed.length === 0) {
      throw new KilnryError('NOT_FOUND', 'Session not found.');
    }
    await services.database.db.insert(auditEvents).values({
      id: ulid(),
      actor: `user:${current.user.id}`,
      action: 'session.revoke',
      target: input.session_id,
      meta: { current: input.session_id === current.session.id },
    });
    return NextResponse.json({ ok: true, current_revoked: input.session_id === current.session.id });
  } catch (error) {
    return errorResponse(error);
  }
}

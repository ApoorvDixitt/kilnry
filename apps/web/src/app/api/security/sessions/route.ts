// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { and, desc, eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import * as z from 'zod';
import { KilnryError, ulid } from '@kilnry/core';
import { auditEvents, sessions } from '@kilnry/db';
import { getAuth } from '../../../../server/auth';
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
    const [owned] = await services.database.db
      .select({ token: sessions.token })
      .from(sessions)
      .where(and(eq(sessions.id, input.session_id), eq(sessions.userId, current.user.id)))
      .limit(1);
    if (!owned) {
      throw new KilnryError('NOT_FOUND', 'Session not found.');
    }
    // Revoke through better-auth, not by deleting its row (F-76), so its own
    // bookkeeping runs and a session cookie cache, if one is ever enabled, cannot
    // keep a revoked session alive. better-auth 1.7.5's /revoke-session
    // (dist/api/routes/session.mjs:377) checks the token belongs to the caller
    // and calls internalAdapter.deleteSession(token); it answers `status: true`
    // even for a token it did not find, so ownership is checked above.
    await getAuth().api.revokeSession({ body: { token: owned.token }, headers: await headers() });
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

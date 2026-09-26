// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// List chat sessions per Project folder (F-CHT-12, TRD-11 §12). The sidebar
// sheet shows each session's title, folder, date, spend and model; an optional
// folder filter narrows the list to one Project. Deleting a session removes its
// messages, never its assets.

import { NextResponse } from 'next/server';
import * as z from 'zod';
import { chatMessages, chatSessions } from '@kilnry/db';
import { desc, eq } from 'drizzle-orm';
import { errorResponse, requireSession } from '../../../../server/http';
import { runtimeServices } from '../../../../server/runtime';

export async function GET(request: Request): Promise<Response> {
  try {
    await requireSession();
    const folder = new URL(request.url).searchParams.get('folder');
    const services = await runtimeServices();
    const rows = await services.database.db.select().from(chatSessions).orderBy(desc(chatSessions.updatedAt));
    const sessions = rows
      .filter((row) => (folder ? row.folder === folder : true))
      .map((row) => ({
        id: row.id,
        title: row.title ?? row.id,
        folder: row.folder ?? 'inbox',
        model: row.llmModel ?? null,
        spent_usd: Number(row.spentUsd ?? 0),
        updated_at: row.updatedAt.toISOString(),
      }));
    return NextResponse.json({ sessions });
  } catch (error) {
    return errorResponse(error);
  }
}

const DeleteInput = z.object({ session_id: z.string().min(1) });

export async function DELETE(request: Request): Promise<Response> {
  try {
    await requireSession();
    const body = DeleteInput.parse(await request.json());
    const services = await runtimeServices();
    // Deleting a session removes its messages, never its assets (TRD-11 §12).
    await services.database.db.delete(chatMessages).where(eq(chatMessages.sessionId, body.session_id));
    await services.database.db.delete(chatSessions).where(eq(chatSessions.id, body.session_id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

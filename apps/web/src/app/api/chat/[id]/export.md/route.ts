// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Export a chat session as a Markdown transcript (F-CHT-12, TRD-11 §12). The
// transcript renders the session's saved messages — text as prose, tool calls
// as blockquote lines with job id and cost, approvals as their decision — with
// front matter naming the session, model, autonomy and spend. It is returned as
// Markdown and, when the session belongs to a Project folder, also written into
// that folder's .kilnry/chats so the record lives beside the work.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { NextResponse } from 'next/server';
import { loadConfig } from '@kilnry/core';
import { chatMessages, chatSessions } from '@kilnry/db';
import { asc, eq } from 'drizzle-orm';
import { errorResponse, requireSession } from '../../../../../server/http';
import { runtimeServices } from '../../../../../server/runtime';
import { renderTranscript } from '../../../../../server/chat-transcript';

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'chat'
  );
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireSession();
    const { id } = await context.params;
    const services = await runtimeServices();
    const [session] = await services.database.db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, id))
      .limit(1);
    if (!session) return NextResponse.json({ error: 'Session not found.' }, { status: 404 });
    const rows = await services.database.db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, id))
      .orderBy(asc(chatMessages.createdAt));

    const markdown = renderTranscript(
      {
        id: session.id,
        title: session.title,
        llm_model: session.llmModel,
        autonomy: session.autonomy,
        spent_usd: Number(session.spentUsd ?? 0),
      },
      rows.map((row) => ({ role: row.role, parts: row.parts })),
    );

    // Write the transcript beside the work when the session has a folder.
    const config = await loadConfig();
    let path: string | undefined;
    if (session.folder && config.library_root) {
      const base = resolve(config.library_root);
      const dir = resolve(base, session.folder, '.kilnry', 'chats');
      if (dir === base || dir.startsWith(`${base}/`)) {
        const date = new Date().toISOString().slice(0, 10);
        const name = `${date}_${slug(session.title ?? id)}.md`;
        try {
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, name), markdown, 'utf8');
          path = join(session.folder, '.kilnry', 'chats', name);
        } catch {
          // A write failure does not fail the export; the Markdown is still returned.
        }
      }
    }

    return new NextResponse(markdown, {
      status: 200,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${slug(session.title ?? id)}.md"`,
        ...(path ? { 'X-Kilnry-Written-Path': path } : {}),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

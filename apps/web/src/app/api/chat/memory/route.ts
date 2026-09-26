// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Read and write a Project folder's memory (F-CHT-09, TRD-11 §7). The Chat
// session's Settings tab shows this file with Edit; the agent reads the same
// file at the start of every turn. Writing goes through the owner here, and the
// user confirms in the interface — the agent may only append to a Notes section
// through the Library tool after an explicit "remember" (TRD-11 §7).

import { NextResponse } from 'next/server';
import * as z from 'zod';
import { loadConfig } from '@kilnry/core';
import { errorResponse, requireSession } from '../../../../server/http';
import { readProjectMemory, writeProjectMemory } from '../../../../server/project-memory';

const FolderQuery = z.string().min(1).max(512);
const PutInput = z.object({ folder: FolderQuery, text: z.string().max(65_536) });

export async function GET(request: Request): Promise<Response> {
  try {
    await requireSession();
    const folder = new URL(request.url).searchParams.get('folder');
    const parsed = FolderQuery.safeParse(folder);
    if (!parsed.success) return NextResponse.json({ text: '' });
    const config = await loadConfig();
    const text = readProjectMemory(config.library_root ?? '', parsed.data);
    return NextResponse.json({ folder: parsed.data, text });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    await requireSession();
    const body = PutInput.parse(await request.json());
    const config = await loadConfig();
    const ok = writeProjectMemory(config.library_root ?? '', body.folder, body.text);
    return NextResponse.json({ ok }, { status: ok ? 200 : 422 });
  } catch (error) {
    return errorResponse(error);
  }
}

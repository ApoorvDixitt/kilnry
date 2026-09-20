// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextResponse } from 'next/server';
import * as z from 'zod';
import { createSmartFolder, deleteSmartFolder, listSmartFolders, renameSmartFolder } from '@kilnry/core';
import { errorResponse, requireSession } from '../../../../server/http';
import { runtimeServices } from '../../../../server/runtime';

const PostBody = z.object({ name: z.string().min(1).max(64), query: z.string().max(400).default('') });
const PatchBody = z.object({ id: z.string(), name: z.string().min(1).max(64) });
const DeleteBody = z.object({ id: z.string() });

// Smart folders are saved searches shown in the Library tree (F-LIB-07).
export async function GET(): Promise<Response> {
  try {
    await requireSession();
    const services = await runtimeServices();
    return NextResponse.json({ smart_folders: await listSmartFolders(services.database) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    await requireSession();
    const body = PostBody.parse(await request.json());
    const services = await runtimeServices();
    const folder = await createSmartFolder(services.database, body.name, body.query);
    return NextResponse.json({ smart_folder: folder });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    await requireSession();
    const body = PatchBody.parse(await request.json());
    const services = await runtimeServices();
    await renameSmartFolder(services.database, body.id, body.name);
    return NextResponse.json({ smart_folders: await listSmartFolders(services.database) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    await requireSession();
    const body = DeleteBody.parse(await request.json());
    const services = await runtimeServices();
    await deleteSmartFolder(services.database, body.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

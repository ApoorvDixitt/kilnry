// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextResponse } from 'next/server';
import * as z from 'zod';
import { KilnryError, createFolder, listFolders, loadConfig } from '@kilnry/core';
import { errorResponse, requireSession } from '../../../../server/http';

const CreateFolder = z.object({
  parent: z.string().max(900).default(''),
  name: z.string().min(1).max(200),
});

function libraryRoot(): string {
  const config = loadConfig();
  if (!config.library_root) throw new KilnryError('NOT_FOUND', 'Library root is not configured.');
  return config.library_root;
}

export async function GET(): Promise<Response> {
  try {
    await requireSession();
    const folders = await listFolders(libraryRoot());
    return NextResponse.json({ folders });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    await requireSession();
    const input = CreateFolder.parse(await request.json());
    await createFolder(libraryRoot(), input.parent, input.name);
    return NextResponse.json({ folders: await listFolders(libraryRoot()) });
  } catch (error) {
    return errorResponse(error);
  }
}

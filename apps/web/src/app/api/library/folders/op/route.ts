// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextResponse } from 'next/server';
import * as z from 'zod';
import {
  KilnryError,
  deleteFolderToTrash,
  listFolders,
  loadConfig,
  moveFolder,
  renameFolder,
} from '@kilnry/core';
import { errorResponse, requireSession } from '../../../../../server/http';

const FolderOp = z.discriminatedUnion('op', [
  z.object({ op: z.literal('rename'), folder: z.string().min(1).max(900), name: z.string().min(1).max(200) }),
  z.object({
    op: z.literal('move'),
    folder: z.string().min(1).max(900),
    destination: z.string().max(900).default(''),
  }),
  z.object({ op: z.literal('delete'), folder: z.string().min(1).max(900) }),
]);

function libraryRoot(): string {
  const config = loadConfig();
  if (!config.library_root) throw new KilnryError('NOT_FOUND', 'Library root is not configured.');
  return config.library_root;
}

export async function POST(request: Request): Promise<Response> {
  try {
    await requireSession();
    const input = FolderOp.parse(await request.json());
    const root = libraryRoot();
    if (input.op === 'rename') await renameFolder(root, input.folder, input.name);
    else if (input.op === 'move') await moveFolder(root, input.folder, input.destination);
    else await deleteFolderToTrash(root, input.folder);
    return NextResponse.json({ folders: await listFolders(root) });
  } catch (error) {
    return errorResponse(error);
  }
}

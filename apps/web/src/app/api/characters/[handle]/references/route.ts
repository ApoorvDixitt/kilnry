// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextResponse } from 'next/server';
import * as z from 'zod';
import {
  KilnryError,
  addReferences,
  loadFullCharacter,
  lookupHandle,
  parseHandlePin,
  removeReference,
} from '@kilnry/core';
import { errorResponse, requireSession } from '../../../../../server/http';
import { runtimeServices } from '../../../../../server/runtime';

const Role = z.enum(['anchor', 'turnaround', 'expression', 'outfit', 'state', 'prop']);
const PostBody = z.object({
  references: z
    .array(
      z.object({
        asset_id: z.string(),
        role: Role,
        view: z.string().optional(),
        label: z.string().optional(),
        weight: z.number().min(0).max(1).optional(),
      }),
    )
    .min(1),
});
const DeleteBody = z.object({ reference_id: z.string() });

async function headFor(
  handle: string,
): Promise<{ db: Awaited<ReturnType<typeof runtimeServices>>['database']; id: string; handle: string }> {
  const services = await runtimeServices();
  const pin = parseHandlePin(decodeURIComponent(handle));
  const head = await lookupHandle(services.database, pin.handle);
  if (!head) throw new KilnryError('NOT_FOUND', `@${pin.handle} is not a Character.`);
  return { db: services.database, id: head.id, handle: head.handle };
}

// Add references to a Character (the detail-page dropzone, F-CHR-03).
export async function POST(
  request: Request,
  context: { params: Promise<{ handle: string }> },
): Promise<Response> {
  try {
    await requireSession();
    const { handle } = await context.params;
    const body = PostBody.parse(await request.json());
    const target = await headFor(handle);
    await addReferences(target.db, target.id, body.references);
    const item = await loadFullCharacter(target.db, target.handle);
    return NextResponse.json({ item });
  } catch (error) {
    return errorResponse(error);
  }
}

// Remove one reference from a Character.
export async function DELETE(
  request: Request,
  context: { params: Promise<{ handle: string }> },
): Promise<Response> {
  try {
    await requireSession();
    const { handle } = await context.params;
    const body = DeleteBody.parse(await request.json());
    const target = await headFor(handle);
    await removeReference(target.db, target.id, body.reference_id);
    const item = await loadFullCharacter(target.db, target.handle);
    return NextResponse.json({ item });
  } catch (error) {
    return errorResponse(error);
  }
}

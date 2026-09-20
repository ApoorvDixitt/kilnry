// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextResponse } from 'next/server';
import * as z from 'zod';
import {
  KilnryError,
  addReferences,
  createCharacter,
  loadFullCharacter,
  lookupHandle,
  removeReference,
  setConsent,
  linkStateVariant,
  approvalIndex,
  startSheetRun,
  advanceSheetRun,
  approveSheetRun,
  denySheetRun,
  getSheetRun,
  suggestStateHandle,
  type CharacterKind,
} from '@kilnry/core';
import { characters } from '@kilnry/db';
import { eq } from 'drizzle-orm';
import { assertMayMutate, errorResponse, requireSessionOrBearer } from '../../../../server/http';
import { runtimeServices } from '../../../../server/runtime';
import { sheetEngine, sheetSink } from '../../../../server/sheet-sink';

const Kind = z.enum(['character', 'prop', 'environment', 'style']);
const Role = z.enum(['anchor', 'turnaround', 'expression', 'outfit', 'state', 'prop']);
const ConsentStatus = z.enum(['self', 'written', 'none', 'n/a']);

const Body = z.object({
  action: z.enum([
    'create',
    'update',
    'add_references',
    'remove_reference',
    'set_consent',
    'add_state_variant',
    'build_sheet',
    'approve_sheet',
    'deny_sheet',
  ]),
  handle: z.string().optional(),
  run_id: z.string().optional(),
  kind: Kind.optional(),
  display_name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
  tags: z.array(z.string()).max(20).optional(),
  is_real_person: z.boolean().optional(),
  state_label: z.string().min(1).max(40).optional(),
  variant_handle: z.string().optional(),
  sheet: z
    .object({
      views: z.array(z.string()).optional(),
      expressions: z.boolean().optional(),
      outfits: z.array(z.object({ label: z.string() })).optional(),
      states: z.array(z.object({ label: z.string() })).optional(),
    })
    .optional(),
  from: z
    .object({
      asset_ids: z.array(z.string()).optional(),
      text: z.string().optional(),
    })
    .optional(),
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
    .optional(),
  reference_id: z.string().optional(),
  consent: z
    .object({
      is_real_person: z.boolean(),
      status: ConsentStatus,
      evidence_asset_id: z.string().optional(),
      license: z.enum(['private', 'cc0', 'cc-by', 'commercial-release']).optional(),
    })
    .optional(),
});

// Create and change Characters and Elements (F-CHR-02, F-CHR-03, F-CHR-06). The
// spending actions (train, build_sheet) arrive with the reference-sheet pipeline.
export async function POST(request: Request): Promise<Response> {
  try {
    const auth = await requireSessionOrBearer(request);
    assertMayMutate(auth);
    const body = Body.parse(await request.json());
    const services = await runtimeServices();
    const db = services.database;

    if (body.action === 'create') {
      if (!body.handle || !body.display_name) {
        throw new KilnryError('INVALID_INPUT', 'A handle and a display name are required.');
      }
      const head = await createCharacter(db, {
        handle: body.handle,
        kind: (body.kind ?? 'character') as CharacterKind,
        display_name: body.display_name,
        ...(body.description ? { description: body.description } : {}),
        ...(body.tags ? { tags: body.tags } : {}),
        ...(body.is_real_person !== undefined ? { is_real_person: body.is_real_person } : {}),
      });
      if (body.references && body.references.length > 0) {
        await addReferences(db, head.id, body.references);
      }
      const item = await loadFullCharacter(db, head.handle);
      return NextResponse.json({ item });
    }

    if (body.action === 'approve_sheet' || body.action === 'deny_sheet') {
      // Approve or deny the turnaround at the sheet run's checkpoint (F-CHR-04).
      if (!body.run_id) throw new KilnryError('INVALID_INPUT', 'A run id is required.');
      if (body.action === 'deny_sheet') {
        const status = await denySheetRun(db, body.run_id);
        return NextResponse.json({ run: await getSheetRun(db, body.run_id), status });
      }
      const engine = await sheetEngine();
      const sink = await sheetSink();
      const status = await approveSheetRun(db, engine, sink, body.run_id);
      return NextResponse.json({ run: await getSheetRun(db, body.run_id), status });
    }

    if (!body.handle) throw new KilnryError('INVALID_INPUT', 'A handle is required.');
    const head = await lookupHandle(db, body.handle);
    if (!head) throw new KilnryError('NOT_FOUND', `@${body.handle.replace(/^@/, '')} is not a Character.`);

    if (body.action === 'update') {
      await db.db
        .update(characters)
        .set({
          ...(body.display_name ? { displayName: body.display_name } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.tags ? { tags: body.tags } : {}),
          updatedAt: new Date(),
        })
        .where(eq(characters.id, head.id));
    } else if (body.action === 'add_references') {
      if (!body.references || body.references.length === 0) {
        throw new KilnryError('INVALID_INPUT', 'No references supplied.');
      }
      await addReferences(db, head.id, body.references);
    } else if (body.action === 'remove_reference') {
      if (!body.reference_id) throw new KilnryError('INVALID_INPUT', 'A reference id is required.');
      await removeReference(db, head.id, body.reference_id);
    } else if (body.action === 'set_consent') {
      if (!body.consent) throw new KilnryError('INVALID_INPUT', 'Consent details are required.');
      await setConsent(db, head.id, body.consent);
    } else if (body.action === 'add_state_variant') {
      if (!body.state_label) throw new KilnryError('INVALID_INPUT', 'A state label is required.');
      // A state variant is its own Element sharing the base's kind, linked by a
      // state group (PRD-08 A2). Files are never shared between states.
      const variantHandle = body.variant_handle ?? suggestStateHandle(head.handle, body.state_label);
      const variant = await createCharacter(db, {
        handle: variantHandle,
        kind: head.kind as CharacterKind,
        display_name: `${head.display_name} · ${body.state_label}`,
        tags: [`state:${body.state_label}`],
      });
      await linkStateVariant(db, head.handle, variant.handle);
      const item = await loadFullCharacter(db, variant.handle);
      return NextResponse.json({ item });
    } else if (body.action === 'build_sheet') {
      // Start the reference-sheet run on the minimal executor (F-CHR-04): plan
      // the steps, submit the first turnaround sheet job with the anchor as the
      // reference, drive the machine to the approval checkpoint, and return the
      // run id with its steps so the detail screen can show progress and approve.
      const full = await loadFullCharacter(db, head.handle);
      const short =
        `${(full.appearance.descriptor ?? '').split('.')[0] ?? ''}. ${(full.appearance.anchors ?? []).join(', ')}`.trim();
      const anchorAssetId =
        full.references.find((reference) => reference.role === 'anchor')?.asset_id ?? null;
      const folder = `People/${head.handle}`;
      const engine = await sheetEngine();
      const sink = await sheetSink();
      const started = await startSheetRun(db, engine, {
        characterId: head.id,
        anchorAssetId,
        folder,
        short,
        ...(body.sheet?.views ? { views: body.sheet.views as never } : {}),
        ...(body.sheet?.expressions !== undefined ? { expressions: body.sheet.expressions } : {}),
        ...(body.sheet?.outfits ? { outfits: body.sheet.outfits } : {}),
        ...(body.sheet?.states ? { states: body.sheet.states } : {}),
      });
      // Advance until the machine submits a job (running) or reaches approval.
      // A submit failure (for example no connected image model in this
      // workspace) does not lose the plan; the run stays resumable.
      let status = 'running';
      try {
        status = await advanceSheetRun(db, engine, sink, started.run_id);
        for (let guard = 0; guard < 20 && status === 'running'; guard += 1) {
          status = await advanceSheetRun(db, engine, sink, started.run_id);
        }
      } catch {
        status = 'running';
      }
      return NextResponse.json({
        run_id: started.run_id,
        status,
        plan: { steps: started.steps, approval_at: approvalIndex(started.steps) },
      });
    }

    const item = await loadFullCharacter(db, head.handle);
    return NextResponse.json({ item });
  } catch (error) {
    return errorResponse(error);
  }
}

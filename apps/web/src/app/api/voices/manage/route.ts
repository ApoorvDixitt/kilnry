// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextResponse } from 'next/server';
import * as z from 'zod';
import { KilnryError, bindVoice, unbindVoice, lookupHandle, loadFullCharacter } from '@kilnry/core';
import { assertMayMutate, errorResponse, requireSessionOrBearer } from '../../../../server/http';
import { runtimeServices } from '../../../../server/runtime';
import { voiceCloner } from '../../../../server/voices';

const Body = z.object({
  action: z.enum(['clone', 'bind', 'unbind']),
  handle: z.string().optional(),
  // Cloning.
  name: z.string().min(1).max(60).optional(),
  provider: z.enum(['minimax', 'elevenlabs', 'fal']).optional(),
  sample_url: z.string().optional(),
  sample_seconds: z.number().optional(),
  consent: z.boolean().optional(),
  confirm_cost_usd: z.number().optional(),
  // Binding a preset or clone by its stored ulid.
  voice_ulid: z.string().optional(),
});

// Clone a voice (F-VOI-02) or bind/unbind one to a Character version (F-CHR-08).
// Cloning is gated by consent and an acknowledged cost inside the orchestrator.
export async function POST(request: Request): Promise<Response> {
  try {
    const auth = await requireSessionOrBearer(request);
    assertMayMutate(auth);
    const body = Body.parse(await request.json());
    const services = await runtimeServices();
    const db = services.database;

    if (body.action === 'clone') {
      if (!body.name || !body.sample_url) {
        throw new KilnryError('INVALID_INPUT', 'A name and a sample are required.');
      }
      if (body.consent !== true) {
        throw new KilnryError('CONFIRMATION_REQUIRED', 'Confirm consent to clone this voice.');
      }
      if (body.confirm_cost_usd === undefined) {
        throw new KilnryError('CONFIRMATION_REQUIRED', 'Confirm the clone cost first.');
      }
      const cloner = await voiceCloner();
      const result = await cloner.clone({
        name: body.name,
        provider: body.provider ?? 'minimax',
        sample_url: body.sample_url,
        sample_seconds: body.sample_seconds ?? 0,
        consent_confirmed: true,
        confirmed_cost_usd: body.confirm_cost_usd,
        ...(body.handle ? { bind_to: body.handle } : {}),
      });
      return NextResponse.json({ voice: result });
    }

    if (!body.handle) throw new KilnryError('INVALID_INPUT', 'A handle is required.');
    const head = await lookupHandle(db, body.handle);
    if (!head) throw new KilnryError('NOT_FOUND', `@${body.handle.replace(/^@/, '')} is not a Character.`);

    if (body.action === 'unbind') {
      await unbindVoice(db, head.id, head.current_version);
    } else {
      // Binding a preset or a clone is free (PRD-07 §9).
      if (!body.voice_ulid) throw new KilnryError('INVALID_INPUT', 'A voice is required to bind.');
      await bindVoice(db, head.id, head.current_version, body.voice_ulid);
    }
    const item = await loadFullCharacter(db, head.handle);
    return NextResponse.json({ item });
  } catch (error) {
    return errorResponse(error);
  }
}

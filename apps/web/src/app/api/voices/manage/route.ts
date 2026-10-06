// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextResponse } from 'next/server';
import * as z from 'zod';
import {
  setDefaultVoice,
  KilnryError,
  bindVoice,
  bindPresetVoice,
  unbindVoice,
  lookupHandle,
  loadFullCharacter,
} from '@kilnry/core';
import { assertMayMutate, errorResponse, requireSessionOrBearer } from '../../../../server/http';
import { runtimeServices } from '../../../../server/runtime';
import { voiceCloner, voiceDeleter, voiceDesigner } from '../../../../server/voices';

const Body = z.object({
  action: z.enum(['clone', 'bind', 'unbind', 'design', 'set_default', 'delete']),
  handle: z.string().optional(),
  // Cloning.
  name: z.string().min(1).max(60).optional(),
  provider: z.enum(['minimax', 'elevenlabs', 'kling', 'fal']).optional(),
  sample_url: z.string().optional(),
  // A recording the user uploaded into the Library (PRD-08:230, F-118).
  sample_asset_id: z.string().optional(),
  sample_seconds: z.number().optional(),
  consent: z.boolean().optional(),
  confirm_cost_usd: z.number().optional(),
  // Design (F-VOI-03).
  description: z.string().optional(),
  preview_text: z.string().optional(),
  language: z.string().optional(),
  gender: z.string().optional(),
  // Binding a preset or clone by its stored ulid.
  voice_ulid: z.string().optional(),
  // Binding a provider-preset voice by its provider and voice id.
  preset_provider: z.string().optional(),
  preset_voice_id: z.string().optional(),
  preset_name: z.string().optional(),
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
        ...(body.sample_asset_id ? { sample_asset_id: body.sample_asset_id } : {}),
        consent_confirmed: true,
        confirmed_cost_usd: body.confirm_cost_usd,
        ...(body.handle ? { bind_to: body.handle } : {}),
      });
      return NextResponse.json({ voice: result });
    }

    if (body.action === 'design') {
      if (!body.name || !body.description || !body.preview_text) {
        throw new KilnryError('INVALID_INPUT', 'A name, a description and preview text are required.');
      }
      if (body.confirm_cost_usd === undefined) {
        throw new KilnryError('CONFIRMATION_REQUIRED', 'Confirm the design cost first.');
      }
      const provider = body.provider === 'fal' ? 'fal' : 'minimax';
      const designer = await voiceDesigner();
      const result = await designer.design({
        name: body.name,
        provider,
        description: body.description,
        preview_text: body.preview_text,
        confirmed_cost_usd: body.confirm_cost_usd,
        ...(body.language ? { language: body.language } : {}),
        ...(body.gender ? { gender: body.gender } : {}),
        ...(body.handle ? { bind_to: body.handle } : {}),
      });
      return NextResponse.json({ voice: result });
    }

    // PRD-08:202's row actions reach the Voices tab, where there is no
    // Character in the url (UX-16).
    if (body.action === 'set_default') {
      if (!body.voice_ulid) throw new KilnryError('INVALID_INPUT', 'A voice is required.');
      await setDefaultVoice(db, body.voice_ulid);
      return NextResponse.json({ ok: true, default_voice_ulid: body.voice_ulid });
    }

    if (body.action === 'delete') {
      if (!body.voice_ulid) throw new KilnryError('INVALID_INPUT', 'A voice is required.');
      const deleter = await voiceDeleter();
      await deleter.delete(body.voice_ulid);
      return NextResponse.json({ ok: true });
    }

    if (!body.handle) throw new KilnryError('INVALID_INPUT', 'A handle is required.');
    const head = await lookupHandle(db, body.handle);
    if (!head) throw new KilnryError('NOT_FOUND', `@${body.handle.replace(/^@/, '')} is not a Character.`);

    if (body.action === 'unbind') {
      await unbindVoice(db, head.id, head.current_version);
    } else {
      // Binding a preset or a clone is free (PRD-07 §9). A stored clone binds by
      // its ulid; a provider-preset voice binds by its provider and voice id,
      // which is persisted as a stored voice first.
      if (body.preset_provider && body.preset_voice_id) {
        await bindPresetVoice(db, head.id, head.current_version, {
          provider: body.preset_provider,
          voice_id: body.preset_voice_id,
          ...(body.preset_name ? { name: body.preset_name } : {}),
        });
      } else if (body.voice_ulid) {
        await bindVoice(db, head.id, head.current_version, body.voice_ulid);
      } else {
        throw new KilnryError('INVALID_INPUT', 'A voice is required to bind.');
      }
    }
    const item = await loadFullCharacter(db, head.handle);
    return NextResponse.json({ item });
  } catch (error) {
    return errorResponse(error);
  }
}

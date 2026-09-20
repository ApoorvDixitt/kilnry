// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextResponse } from 'next/server';
import * as z from 'zod';
import {
  KilnryError,
  ProviderIdSchema,
  connectProvider,
  detectProviderKey,
  disconnectProvider,
} from '@kilnry/core';
import { adapters } from '@kilnry/providers';
import { errorResponse, requireSession } from '../../../../../server/http';
import { createRecoveryChallenge } from '../../../../../server/recovery-challenge';
import { ensureRuntimeEngine, runtimeServices } from '../../../../../server/runtime';

const Input = z.object({
  key: z.string().min(8).max(512),
  label: z.string().max(80).optional(),
  save_anyway: z.boolean().default(false),
  accept_tos: z.boolean().default(false),
});

async function providerFrom(id: string, key?: string) {
  if (id !== 'auto') return ProviderIdSchema.parse(id);
  if (!key) throw new KilnryError('INVALID_INPUT', 'Paste a key before using automatic detection.');
  const candidates = detectProviderKey(key);
  if (candidates.length !== 1) {
    throw new KilnryError(
      'INVALID_INPUT',
      candidates.length === 0
        ? "We don't recognise this key format. Pick the provider."
        : 'This key format could belong to more than one provider. Pick the provider.',
      { details: { candidates } },
    );
  }
  return candidates[0]!.provider;
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const session = await requireSession();
    await ensureRuntimeEngine();
    const input = Input.parse(await request.json());
    const provider = await providerFrom((await context.params).id, input.key);
    const services = await runtimeServices();
    const result = await connectProvider({
      state: services.database,
      keyStore: services.keyStore,
      adapters,
      provider,
      key: input.key,
      ...(input.label === undefined ? {} : { label: input.label }),
      save_anyway: input.save_anyway,
      accept_tos: input.accept_tos,
    });
    return NextResponse.json({
      ...result,
      ...(result.recovery_kit
        ? { confirmation: createRecoveryChallenge(session.session.id, result.recovery_kit) }
        : {}),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireSession();
    const provider = await providerFrom((await context.params).id);
    const services = await runtimeServices();
    await services.keyStore.initialize();
    await disconnectProvider({ keyStore: services.keyStore, provider });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

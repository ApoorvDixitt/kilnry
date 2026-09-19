// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import * as z from 'zod';
import { getSetting, putSetting } from '@kilnry/db';
import { errorResponse, requireSession } from '../../../../server/http';
import { auth } from '../../../../server/auth';
import { createRecoveryChallenge, verifyRecoveryChallenge } from '../../../../server/recovery-challenge';
import { ensureRuntimeEngine, runtimeServices } from '../../../../server/runtime';

const Input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('view'), password: z.string().min(1) }),
  z.object({ action: z.literal('restore'), recovery_kit: z.string().min(20) }),
  z.object({
    action: z.literal('acknowledge'),
    challenge_token: z.string().min(20),
    answers: z
      .array(z.object({ group: z.number().int().positive(), value: z.string().min(1).max(4) }))
      .length(2),
  }),
]);

export async function GET(): Promise<Response> {
  try {
    await requireSession();
    await ensureRuntimeEngine();
    const services = await runtimeServices();
    return NextResponse.json({
      status: services.keyStore.status(),
      recovery_kit_confirmed_at: await getSetting<string>('recovery_kit_confirmed_at'),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const session = await requireSession();
    await ensureRuntimeEngine();
    const input = Input.parse(await request.json());
    const services = await runtimeServices();
    if (input.action === 'view') {
      await auth.api.verifyPassword({ body: { password: input.password }, headers: await headers() });
      const recoveryKit = services.keyStore.recoveryKit();
      return NextResponse.json({
        recovery_kit: recoveryKit,
        confirmation: createRecoveryChallenge(session.session.id, recoveryKit),
      });
    }
    if (input.action === 'restore') {
      await services.keyStore.restoreRecoveryKit(input.recovery_kit);
      await putSetting('recovery_kit_used_at', new Date().toISOString());
      return NextResponse.json({ ok: true, status: services.keyStore.status() });
    }
    verifyRecoveryChallenge(session.session.id, input.challenge_token, input.answers);
    await putSetting('recovery_kit_confirmed_at', new Date().toISOString());
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import * as z from 'zod';
import { ulid } from '@kilnry/core';
import { auditEvents, getSetting, putSetting } from '@kilnry/db';
import { errorResponse, requireSession } from '../../../../server/http';
import { getAuth } from '../../../../server/auth';
import { ensureRuntimeEngine, runtimeServices } from '../../../../server/runtime';

const Input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('view'), password: z.string().min(1) }),
  z.object({ action: z.literal('restore'), recovery_kit: z.string().min(20) }),
  // Acceptance harness only; the key store refuses it outside KILNRY_TEST_MSW
  // and in release builds (S-22 locks the store without a process restart).
  z.object({ action: z.literal('simulate_key_loss') }),
  // One checkbox, never a transcription quiz (D-63): the user says they have
  // stored the kit and Done records recovery_kit_viewed_at.
  z.object({ action: z.literal('acknowledge'), stored: z.literal(true) }),
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
      await getAuth().api.verifyPassword({ body: { password: input.password }, headers: await headers() });
      return NextResponse.json({ recovery_kit: services.keyStore.recoveryKit() });
    }
    if (input.action === 'simulate_key_loss') {
      services.keyStore.simulateMasterKeyLoss();
      return NextResponse.json({ ok: true, status: services.keyStore.status() });
    }
    if (input.action === 'restore') {
      // Check the kit first and answer a mismatch here with a typed 400; the
      // store's own error would cross a module boundary and lose its type.
      const check = await services.keyStore.checkRecoveryKit(input.recovery_kit);
      if (!check.ok) {
        return NextResponse.json(
          {
            error: {
              code: 'INVALID_INPUT',
              message: check.message,
              retryable: false,
              ...(check.checksum_words ? { details: { checksum_words: check.checksum_words } } : {}),
            },
          },
          { status: 400 },
        );
      }
      await services.keyStore.restoreRecoveryKit(input.recovery_kit);
      await putSetting('recovery_kit_used_at', new Date().toISOString());
      // Record the recovery in the audit log so S-22 can assert recovery_kit.used
      // after the keys are restored from a lost master key.
      await services.database.db.insert(auditEvents).values({
        id: ulid(),
        actor: `user:${session.user.id}`,
        action: 'recovery_kit.used',
        target: null,
        meta: {},
      });
      return NextResponse.json({ ok: true, status: services.keyStore.status() });
    }
    const now = new Date().toISOString();
    await putSetting('recovery_kit_confirmed_at', now);
    // PRD-16 §8: Done sets recovery_kit_viewed_at, which the checklist item and
    // the Providers banner read.
    await putSetting('recovery_kit_viewed_at', now);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

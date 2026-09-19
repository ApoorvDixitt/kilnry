// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import * as z from 'zod';
import { KilnryError } from '@kilnry/core';
import { getSetting, putSetting } from '@kilnry/db';
import { errorResponse, requireSession } from '../../../../server/http';
import { auth } from '../../../../server/auth';
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

interface RecoveryChallenge {
  session_id: string;
  expires_at: number;
  groups: string[];
  required: number[];
}

const challenges = new Map<string, RecoveryChallenge>();

function sameText(left: string, right: string): boolean {
  const first = Buffer.from(left.toLowerCase());
  const second = Buffer.from(right.toLowerCase());
  return first.length === second.length && timingSafeEqual(first, second);
}

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
      const groups =
        recoveryKit
          .replace(/[\s-]/g, '')
          .slice('kilnry1'.length)
          .match(/.{1,4}/g) ?? [];
      if (groups.length < 2) throw new Error('Recovery kit did not contain enough confirmation groups.');
      const first = randomInt(groups.length);
      let second = randomInt(groups.length - 1);
      if (second >= first) second += 1;
      const required = [first, second].sort((left, right) => left - right);
      const challengeToken = randomBytes(24).toString('base64url');
      challenges.set(challengeToken, {
        session_id: session.session.id,
        expires_at: Date.now() + 5 * 60_000,
        groups,
        required,
      });
      return NextResponse.json({
        recovery_kit: recoveryKit,
        confirmation: {
          challenge_token: challengeToken,
          group_numbers: required.map((index) => index + 1),
        },
      });
    }
    if (input.action === 'restore') {
      await services.keyStore.restoreRecoveryKit(input.recovery_kit);
      await putSetting('recovery_kit_used_at', new Date().toISOString());
      return NextResponse.json({ ok: true, status: services.keyStore.status() });
    }
    const challenge = challenges.get(input.challenge_token);
    challenges.delete(input.challenge_token);
    if (
      !challenge ||
      challenge.session_id !== session.session.id ||
      challenge.expires_at < Date.now() ||
      !challenge.required.every((index) => {
        const answer = input.answers.find((candidate) => candidate.group === index + 1);
        return Boolean(answer && sameText(answer.value, challenge.groups[index] ?? ''));
      })
    ) {
      throw new KilnryError(
        'INVALID_INPUT',
        'Recovery-kit confirmation did not match. View the kit and try again.',
      );
    }
    await putSetting('recovery_kit_confirmed_at', new Date().toISOString());
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

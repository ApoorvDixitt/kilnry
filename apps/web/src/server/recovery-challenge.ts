// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { KilnryError } from '@kilnry/core';

export interface RecoveryConfirmation {
  challenge_token: string;
  group_numbers: number[];
}

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

export function createRecoveryChallenge(sessionId: string, recoveryKit: string): RecoveryConfirmation {
  const now = Date.now();
  for (const [token, challenge] of challenges) {
    if (challenge.expires_at < now) challenges.delete(token);
  }
  const groups =
    recoveryKit
      .replace(/[\s-]/g, '')
      .slice('kilnry1'.length)
      .match(/.{1,4}/g) ?? [];
  const eligible = groups.flatMap((group, index) => (group.length === 4 ? [index] : []));
  if (eligible.length < 2) throw new Error('Recovery kit did not contain enough confirmation groups.');
  const first = randomInt(eligible.length);
  let second = randomInt(eligible.length - 1);
  if (second >= first) second += 1;
  const required = [eligible[first]!, eligible[second]!].sort((left, right) => left - right);
  const challengeToken = randomBytes(24).toString('base64url');
  challenges.set(challengeToken, {
    session_id: sessionId,
    expires_at: now + 5 * 60_000,
    groups,
    required,
  });
  return { challenge_token: challengeToken, group_numbers: required.map((index) => index + 1) };
}

export function verifyRecoveryChallenge(
  sessionId: string,
  token: string,
  answers: Array<{ group: number; value: string }>,
): void {
  const challenge = challenges.get(token);
  challenges.delete(token);
  if (
    !challenge ||
    challenge.session_id !== sessionId ||
    challenge.expires_at < Date.now() ||
    !challenge.required.every((index) => {
      const answer = answers.find((candidate) => candidate.group === index + 1);
      return Boolean(answer && sameText(answer.value, challenge.groups[index] ?? ''));
    })
  ) {
    throw new KilnryError(
      'INVALID_INPUT',
      'Recovery-kit confirmation did not match. View the kit and try again.',
    );
  }
}

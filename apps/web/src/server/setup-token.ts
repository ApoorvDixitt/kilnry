// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The first-run token (PRD-04:16): "32 random bytes, base64url, stores its
// hash, and prints the URL with `?t=<token>`. … The token is single-use and
// expires after 10 minutes." It was stored in plain hex and could be exchanged
// again and again inside the ten minutes (F-68). The file now holds only the
// token's SHA-256, and the first successful exchange replaces it with a
// consumed marker; sign-up deletes the file, and every boot writes a fresh one.

import { createHash, randomBytes } from 'node:crypto';

export const SETUP_TOKEN_FILE = 'first-run.token';
export const SETUP_TOKEN_CONSUMED = 'consumed';
export const SETUP_TOKEN_TTL_MS = 10 * 60_000;

export function newSetupToken(): string {
  return randomBytes(32).toString('base64url');
}

export function setupTokenDigest(token: string): string {
  return `sha256:${createHash('sha256').update(token, 'utf8').digest('hex')}`;
}

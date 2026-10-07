// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// better-auth's own refusals, in words a user can act on (design contract
// rule 8). When the browser's origin is not one Kilnry trusts, better-auth
// answers 403 with `{ code: 'INVALID_ORIGIN', message: 'Invalid origin' }`
// (better-auth 1.7.5, dist/api/middlewares/origin-check.mjs:116 and
// @better-auth/core dist/error/codes.mjs:38), and the sign-up and sign-in forms
// showed "Invalid origin" — a server word that tells the user nothing to do
// (UX-07). The server knows the address it printed at start-up, so the sentence
// names it.

export const INVALID_ORIGIN_CODE = 'INVALID_ORIGIN';

/** The address the launcher prints and better-auth's `baseURL` (auth.ts). */
export function printedAddress(port: number): string {
  return `http://127.0.0.1:${port}`;
}

export function invalidOriginMessage(port: number): string {
  return `Kilnry only accepts sign-in from the address it printed at start-up (${printedAddress(port)}). Open that address and try again.`;
}

/**
 * Rewrite an origin refusal from better-auth into Kilnry's error envelope with
 * the plain sentence; any other response passes through untouched.
 */
export async function plainAuthResponse(response: Response, port: number): Promise<Response> {
  if (response.status !== 403) return response;
  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    return response;
  }
  const code =
    (body as { code?: unknown } | null)?.code ?? (body as { error?: { code?: unknown } } | null)?.error?.code;
  if (code !== INVALID_ORIGIN_CODE) return response;
  return Response.json(
    { error: { code: INVALID_ORIGIN_CODE, message: invalidOriginMessage(port) } },
    { status: 403 },
  );
}

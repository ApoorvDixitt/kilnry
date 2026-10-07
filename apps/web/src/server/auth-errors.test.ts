// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { plainAuthResponse } from './auth-errors';

// UX-07: better-auth answers an untrusted origin with 403
// `{ code: 'INVALID_ORIGIN', message: 'Invalid origin' }` (better-auth 1.7.5,
// APIError.from in @better-auth/core dist/error/index.mjs:19 builds that body),
// and the form showed "Invalid origin".
describe('better-auth refusals in plain words (UX-07)', () => {
  it('names the address Kilnry printed when the origin is refused', async () => {
    const refused = Response.json({ code: 'INVALID_ORIGIN', message: 'Invalid origin' }, { status: 403 });
    const response = await plainAuthResponse(refused, 3123);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: {
        code: 'INVALID_ORIGIN',
        message:
          'Kilnry only accepts sign-in from the address it printed at start-up (http://127.0.0.1:3123). Open that address and try again.',
      },
    });
  });

  it('passes every other response through untouched', async () => {
    const other = Response.json({ code: 'INVALID_EMAIL_OR_PASSWORD', message: 'x' }, { status: 403 });
    expect(await plainAuthResponse(other, 3123)).toBe(other);
    const ok = Response.json({ ok: true });
    expect(await plainAuthResponse(ok, 3123)).toBe(ok);
  });
});

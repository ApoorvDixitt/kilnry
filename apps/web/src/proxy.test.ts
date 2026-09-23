// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it } from 'vitest';
import { proxy } from './proxy';

const original = { release: process.env.KILNRY_RELEASE_BUILD, msw: process.env.KILNRY_TEST_MSW };
afterEach(() => {
  process.env.KILNRY_RELEASE_BUILD = original.release;
  process.env.KILNRY_TEST_MSW = original.msw;
});

function request(path: string, init?: { method?: string; headers?: Record<string, string> }): NextRequest {
  return new NextRequest(new URL(`http://127.0.0.1:3000${path}`), {
    method: init?.method ?? 'GET',
    headers: { host: '127.0.0.1:3000', ...(init?.headers ?? {}) },
  });
}

describe('request proxy security boundaries (F-SET-08)', () => {
  it('refuses to serve when the test mock service worker is set in a release build', () => {
    process.env.KILNRY_RELEASE_BUILD = '1';
    process.env.KILNRY_TEST_MSW = '1';
    const response = proxy(request('/api/models'));
    expect(response.status).toBe(503);
  });

  it('serves normally in a release build when the test hook is off', () => {
    process.env.KILNRY_RELEASE_BUILD = '1';
    delete process.env.KILNRY_TEST_MSW;
    const response = proxy(request('/api/health'));
    expect(response.status).not.toBe(503);
  });

  it('exempts CSRF only for the reindex route, not any path carrying the doctor header', () => {
    delete process.env.KILNRY_RELEASE_BUILD;
    delete process.env.KILNRY_TEST_MSW;
    // A mutating request to another route with the doctor header and no CSRF token
    // is still blocked; the exemption is scoped to the reindex route.
    const blocked = proxy(
      request('/api/generate', {
        method: 'POST',
        headers: { origin: 'http://127.0.0.1:3000', 'x-kilnry-doctor': 'reindex' },
      }),
    );
    expect(blocked.status).toBe(403);
    // The reindex route with the doctor header is exempt and passes the CSRF gate.
    const allowed = proxy(
      request('/api/library/reindex', {
        method: 'POST',
        headers: { origin: 'http://127.0.0.1:3000', 'x-kilnry-doctor': 'reindex' },
      }),
    );
    expect(allowed.status).not.toBe(403);
  });
});

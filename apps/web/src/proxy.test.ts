// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { proxy, ratePolicy } from './proxy';
import { resetRateLimits } from './server/rate-limit';

const original = {
  release: process.env.KILNRY_RELEASE_BUILD,
  msw: process.env.KILNRY_TEST_MSW,
  trustedProxy: process.env.KILNRY_TRUSTED_PROXY,
};
afterEach(() => {
  process.env.KILNRY_RELEASE_BUILD = original.release;
  process.env.KILNRY_TEST_MSW = original.msw;
  if (original.trustedProxy === undefined) delete process.env.KILNRY_TRUSTED_PROXY;
  else process.env.KILNRY_TRUSTED_PROXY = original.trustedProxy;
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

  it('puts every spending route in the 60/min spend bucket (F-SET-08)', () => {
    // TRD-16 §4: a direct generation, a workflow run, a standalone transform and
    // a voice clone all spend and share the strict spend bucket.
    for (const path of [
      '/api/generate',
      '/api/transform',
      '/api/voices/manage',
      '/api/workflows/kilnry-ugc-ad/run',
    ]) {
      expect(ratePolicy(path)).toEqual({ name: 'spend', limit: 60 });
    }
    // A non-spending route stays on the generous default bucket.
    expect(ratePolicy('/api/runs/abc/approve')).toEqual({ name: 'default', limit: 600 });
    // The run-status read is polled while a run proceeds, so it shares the
    // high-limit read bucket, but its sub-routes (approve, cancel) do not.
    expect(ratePolicy('/api/runs/abc')).toEqual({ name: 'media', limit: 2000 });
    expect(ratePolicy('/api/runs/abc/cancel').name).toBe('default');
    // The workflow plan route does not spend, so it is not in the spend bucket.
    expect(ratePolicy('/api/workflows/kilnry-ugc-ad/plan').name).not.toBe('spend');
  });
});

describe('pre-session rate limit keys on the peer, not X-Forwarded-For (F-ONB-02)', () => {
  beforeEach(() => {
    resetRateLimits();
    delete process.env.KILNRY_RELEASE_BUILD;
    delete process.env.KILNRY_TEST_MSW;
    delete process.env.KILNRY_TRUSTED_PROXY;
  });

  it('shares one sign-in bucket across requests with different X-Forwarded-For', () => {
    // The sign-in throttle is "10/min per IP" (TRD-15 §6). An attacker without a
    // session cookie must not be able to mint a fresh bucket by rotating the
    // client-supplied X-Forwarded-For header: ten attempts exhaust the one bucket
    // and the eleventh — with yet another forwarded address — is refused 429.
    let last = proxy(
      request('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { origin: 'http://127.0.0.1:3000', 'x-forwarded-for': '203.0.113.1' },
      }),
    );
    expect(last.status).not.toBe(429);
    for (let attempt = 2; attempt <= 10; attempt += 1) {
      last = proxy(
        request('/api/auth/sign-in/email', {
          method: 'POST',
          headers: { origin: 'http://127.0.0.1:3000', 'x-forwarded-for': `203.0.113.${attempt}` },
        }),
      );
      expect(last.status).not.toBe(429);
    }
    const eleventh = proxy(
      request('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { origin: 'http://127.0.0.1:3000', 'x-forwarded-for': '198.51.100.9' },
      }),
    );
    expect(eleventh.status).toBe(429);
  });

  it('honours X-Forwarded-For only when the trusted-proxy flag is set', () => {
    // Behind a trusted reverse proxy the operator opts in and each real client
    // address keeps its own bucket again.
    process.env.KILNRY_TRUSTED_PROXY = '1';
    for (let attempt = 1; attempt <= 11; attempt += 1) {
      const response = proxy(
        request('/api/auth/sign-in/email', {
          method: 'POST',
          headers: { origin: 'http://127.0.0.1:3000', 'x-forwarded-for': `203.0.113.${attempt}` },
        }),
      );
      expect(response.status).not.toBe(429);
    }
  });
});

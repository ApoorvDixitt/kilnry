// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { hostname, networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { machineLanHosts, proxy, ratePolicy } from './proxy';
import { resetRateLimits } from './server/rate-limit';
import { writeSetupToken } from './server/runtime';

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

  it('shares one sign-in bucket across requests carrying different cookies', () => {
    // A caller with no session can send any cookie it likes. Keying the sign-in
    // bucket on the cookie jar let a rotating `Cookie: a=<n>` mint a fresh
    // bucket per guess exactly as X-Forwarded-For did, so the pre-session
    // bucket is the peer alone. No header besides Host: the eleventh is refused
    // by the limiter before the origin check runs.
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const response = proxy(
        request('/api/auth/sign-in/email', { method: 'POST', headers: { cookie: `a=${attempt}` } }),
      );
      expect(response.status).not.toBe(429);
    }
    const eleventh = proxy(
      request('/api/auth/sign-in/email', { method: 'POST', headers: { cookie: 'a=11' } }),
    );
    expect(eleventh.status).toBe(429);
  });

  it('ignores even a better-auth session cookie for the sign-in bucket', () => {
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      proxy(
        request('/api/auth/sign-in/email', {
          method: 'POST',
          headers: { cookie: `better-auth.session_token=forged-${attempt}` },
        }),
      );
    }
    const eleventh = proxy(
      request('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { cookie: 'better-auth.session_token=forged-11' },
      }),
    );
    expect(eleventh.status).toBe(429);
  });

  it('keys other policies on the better-auth session cookie only, never the whole jar', () => {
    // The provider-test bucket allows 20/min. Twenty requests with one session
    // token and a different unrelated cookie each time share that session's
    // bucket, so the twenty-first is refused; a second session has its own.
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      const response = proxy(
        request('/api/providers/fal/test', {
          headers: { cookie: `better-auth.session_token=session-one; junk=${attempt}` },
        }),
      );
      expect(response.status).not.toBe(429);
    }
    const sameSession = proxy(
      request('/api/providers/fal/test', {
        headers: { cookie: 'better-auth.session_token=session-one; junk=21' },
      }),
    );
    expect(sameSession.status).toBe(429);
    const otherSession = proxy(
      request('/api/providers/fal/test', {
        headers: { cookie: 'better-auth.session_token=session-two' },
      }),
    );
    expect(otherSession.status).not.toBe(429);
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

// F-28: LAN mode accepted any Host literal in an RFC1918 block, so a page that
// rebound an attacker-controlled name to 10.0.0.1 passed the check, and the
// hosts the user confirmed in Settings › Security were written but never read.
// TRD-15 §2 names this machine's own addresses, refreshed every 60 s.
describe('the LAN Host allowlist (F-SET-02)', () => {
  it("is this machine's own addresses and hostname, not a private-range pattern", () => {
    const hosts = machineLanHosts(Date.now());
    const own = Object.values(networkInterfaces())
      .flatMap((entries) => entries ?? [])
      .filter((entry) => !entry.internal)
      .map((entry) => entry.address.toLowerCase());
    for (const address of own) expect(hosts.has(address), address).toBe(true);
    expect(hosts.has(hostname().toLowerCase())).toBe(true);
    // A private address this machine does not hold is not on the list.
    const stranger = own.includes('10.99.99.99') ? '10.99.99.98' : '10.99.99.99';
    expect(hosts.has(stranger)).toBe(false);
  });
});

// F-68: PRD-04:16 — the first-run token is "32 random bytes, base64url", the
// server "stores its hash", and it "is single-use and expires after 10 minutes".
// It was stored in plain hex and could be exchanged again inside the window.
describe('the first-run setup link (F-ONB-01, F-68)', () => {
  let dataDir: string;
  const previous = process.env.KILNRY_DATA_DIR;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'kilnry-setup-token-'));
    process.env.KILNRY_DATA_DIR = dataDir;
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.KILNRY_DATA_DIR;
    else process.env.KILNRY_DATA_DIR = previous;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('opens once, then refuses the same link', () => {
    const token = writeSetupToken(join(dataDir, 'first-run.token'));
    const first = proxy(request(`/welcome?t=${token}`));
    expect(first.status).toBe(307);
    expect(first.cookies.get('kilnry_setup')?.value).toBe('1');
    const second = proxy(request(`/welcome?t=${token}`));
    expect(second.status).toBe(403);
  });

  it('keeps only the hash on disk and refuses a wrong token', () => {
    const token = writeSetupToken(join(dataDir, 'first-run.token'));
    expect(readFileSync(join(dataDir, 'first-run.token'), 'utf8')).not.toContain(token);
    expect(proxy(request(`/welcome?t=${token.slice(0, -1)}x`)).status).toBe(403);
    // The wrong guess does not spend the link.
    expect(proxy(request(`/welcome?t=${token}`)).status).toBe(307);
  });
});

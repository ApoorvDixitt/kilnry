// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { hostname as osHostname, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { ulid } from '@kilnry/core';
import { defaultDataDir, loadConfig } from '@kilnry/core/config';
import {
  SETUP_TOKEN_CONSUMED,
  SETUP_TOKEN_FILE,
  SETUP_TOKEN_TTL_MS,
  setupTokenDigest,
} from './server/setup-token';
import { takeRateLimit } from './server/rate-limit';
import { message } from './lib/messages';

const loopback = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'kilnry.local']);

function hostOnly(value: string | null): string | undefined {
  if (!value || /[\\/\s]/.test(value)) return undefined;
  try {
    return new URL(`http://${value}`).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * The Host values LAN mode accepts: this machine's own addresses, enumerated
 * from os.networkInterfaces() and refreshed every 60 s, plus the hosts the user
 * confirmed in Settings › Security (TRD-15 §2). The check used to accept any
 * literal in an RFC1918 block, so a page that rebound an attacker-controlled
 * name to 10.0.0.1 passed it, and the confirmed list was written but never read
 * (F-28).
 */
const LAN_HOST_TTL_MS = 60_000;
let lanHostCache: { hosts: Set<string>; at: number } | undefined;

export function machineLanHosts(now = Date.now()): Set<string> {
  if (lanHostCache && now - lanHostCache.at < LAN_HOST_TTL_MS) return lanHostCache.hosts;
  const hosts = new Set<string>();
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal) continue;
      hosts.add(entry.address.toLowerCase());
      // An IPv6 literal reaches the Host header in brackets.
      if (entry.family === 'IPv6') hosts.add(`[${entry.address.toLowerCase()}]`);
    }
  }
  const hostname = osHostname().toLowerCase();
  if (hostname) {
    hosts.add(hostname);
    hosts.add(`${hostname}.local`);
  }
  for (const configured of configuredLanHosts()) hosts.add(configured);
  lanHostCache = { hosts, at: now };
  return hosts;
}

function configuredLanHosts(): string[] {
  try {
    const config = loadConfig() as { allowed_hosts?: unknown };
    const list = Array.isArray(config.allowed_hosts) ? config.allowed_hosts : [];
    return list
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => hostOnly(entry) ?? entry.toLowerCase());
  } catch {
    return [];
  }
}

function allowedHost(host: string | undefined): boolean {
  if (!host) return false;
  if (loopback.has(host)) return true;
  if (process.env.KILNRY_LAN !== '1') return false;
  return machineLanHosts().has(host);
}

function scriptSource(nonce: string): string {
  const development = process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : '';
  return `'self' 'nonce-${nonce}' 'strict-dynamic'${development}`;
}

function addSecurityHeaders(
  response: NextResponse,
  nonce: string,
  requestId: string,
  request?: NextRequest,
): NextResponse {
  response.headers.set(
    'Content-Security-Policy',
    `default-src 'self'; script-src ${scriptSource(nonce)}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'`,
  );
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'same-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(self), geolocation=(), payment=()');
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Request-Id', requestId);
  if (!response.headers.has('Cache-Control')) response.headers.set('Cache-Control', 'no-store');
  if (request && !request.cookies.get('kilnry_csrf')) {
    response.cookies.set('kilnry_csrf', randomBytes(32).toString('base64url'), {
      httpOnly: false,
      sameSite: 'lax',
      secure: request.nextUrl.protocol === 'https:',
      path: '/',
    });
  }
  return response;
}

function exchangeSetupToken(request: NextRequest): NextResponse | undefined {
  const supplied = request.nextUrl.searchParams.get('t');
  if (!supplied || request.nextUrl.pathname !== '/welcome') return undefined;
  const path = join(defaultDataDir(), SETUP_TOKEN_FILE);
  if (!existsSync(path)) return NextResponse.redirect(new URL('/welcome', request.url));
  const age = Date.now() - statSync(path).mtimeMs;
  // The file holds the token's hash, never the token (PRD-04:16, F-68).
  const expected = readFileSync(path, 'utf8').trim();
  const left = Buffer.from(setupTokenDigest(supplied));
  const right = Buffer.from(expected);
  const valid = age <= SETUP_TOKEN_TTL_MS && left.length === right.length && timingSafeEqual(left, right);
  if (!valid) return new NextResponse(message('welcome.setupExpired'), { status: 403 });
  // Single-use: the first exchange spends the link. The setup cookie carries
  // the browser through sign-up; a second open of the same link is refused.
  writeFileSync(path, `${SETUP_TOKEN_CONSUMED}\n`, { encoding: 'utf8', mode: 0o600 });
  const response = NextResponse.redirect(new URL('/welcome', request.url));
  response.cookies.set('kilnry_setup', '1', { httpOnly: true, sameSite: 'lax', maxAge: 30 * 60, path: '/' });
  return response;
}

function sameSecret(left: string | undefined, right: string | null): boolean {
  if (!left || !right) return false;
  const first = Buffer.from(left);
  const second = Buffer.from(right);
  return first.length === second.length && timingSafeEqual(first, second);
}

export function ratePolicy(path: string): { name: string; limit: number } {
  if (
    path.startsWith('/api/media/') ||
    path.startsWith('/api/thumb/') ||
    path.startsWith('/api/preview/') ||
    path.startsWith('/api/sprite/') ||
    // Run-status reads are polled by the run view and the acceptance harness
    // while a long run proceeds; they are cheap reads, so they share the
    // high-limit read bucket rather than the 600/min default (F-SET-08).
    /^\/api\/runs\/[^/]+$/.test(path)
  )
    return { name: 'media', limit: 2000 };
  if (path === '/api/estimate') return { name: 'estimate', limit: 120 };
  // Every route that spends money shares the 60/min spend bucket (TRD-16 §4): a
  // direct generation, a workflow run, a standalone transform and a voice clone.
  // Only /api/generate was here before, so the others fell into the 600/min
  // default (F-SET-08). A preset spends through /api/generate, so it is already
  // covered; /api/voices/manage also carries the free bind/unbind actions, but
  // sharing the spend bucket only tightens a low-frequency management route.
  if (
    path === '/api/generate' ||
    path === '/api/transform' ||
    path === '/api/voices/manage' ||
    /^\/api\/workflows\/[^/]+\/run$/.test(path)
  )
    return { name: 'spend', limit: 60 };
  if (/^\/api\/providers\/[^/]+\/test$/.test(path)) return { name: 'provider-test', limit: 20 };
  if (path.startsWith('/api/auth/sign-in/')) {
    // Production keeps a strict sign-in limit. The acceptance harness signs in
    // fresh in every test against one shared server, so under the test mock
    // service worker (which is forbidden in release builds) the limit is raised
    // to keep the suite from tripping a control that production still enforces.
    return { name: 'sign-in', limit: process.env.KILNRY_TEST_MSW === '1' ? 200 : 10 };
  }
  return { name: 'default', limit: 600 };
}

// The better-auth session cookie, by the name auth.ts configures. better-auth
// 1.7.5 builds it as `${secureCookiePrefix}${cookiePrefix}.session_token`, with
// cookiePrefix "better-auth" when `advanced.cookiePrefix` is unset
// (dist/cookies/index.mjs:28-29) and secureCookiePrefix "__Secure-" only when
// `advanced.useSecureCookies` is on (index.mjs:22, cookie-utils.mjs:10).
// auth.ts sets no cookiePrefix and turns secure cookies on with KILNRY_TLS=1.
function sessionCookieName(): string {
  return `${process.env.KILNRY_TLS === '1' ? '__Secure-' : ''}better-auth.session_token`;
}

// Policies a caller meets before it has a session. Their bucket is the peer
// alone: no cookie and no header the caller chose can mint a fresh one.
const PRE_SESSION_POLICIES = new Set(['sign-in']);

function peerKey(request: NextRequest): string {
  // `next start` and the standalone server give the proxy no socket peer, and
  // the app binds loopback (LAN mode has no reverse proxy), so without a proxy
  // the pre-session bucket is one per process (F-05). Behind a trusted reverse
  // proxy the operator sets KILNRY_TRUSTED_PROXY=1 and the first forwarded
  // address is the client (default; adjustable).
  if (process.env.KILNRY_TRUSTED_PROXY === '1') {
    const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    if (forwarded) return `proxy:${forwarded}`;
  }
  return 'peer';
}

function principalKey(request: NextRequest, policy: string): string {
  // Every other policy keys on the session token, never on the whole cookie
  // jar: an unrelated cookie the caller rotates must not mint a new bucket.
  const session = PRE_SESSION_POLICIES.has(policy)
    ? undefined
    : request.cookies.get(sessionCookieName())?.value;
  return createHash('sha256')
    .update(session ? `session:${session}` : peerKey(request))
    .digest('hex')
    .slice(0, 24);
}

// With a src/ App Router the proxy lives at src/proxy.ts; the root location was not executed by Next 16.3 (default; adjustable).
export function proxy(request: NextRequest): NextResponse {
  const nonce = randomBytes(16).toString('base64');
  const requestId = ulid();
  // A release build must never run with the test mock service worker enabled, or
  // the sign-in rate limit and other controls would be relaxed in production. If
  // both are set, refuse to serve any request rather than boot in a weakened
  // state (F-SET-08, TRD-15).
  if (process.env.KILNRY_RELEASE_BUILD === '1' && process.env.KILNRY_TEST_MSW === '1') {
    return addSecurityHeaders(
      new NextResponse('KILNRY_TEST_MSW is forbidden in release builds.', { status: 503 }),
      nonce,
      requestId,
    );
  }
  const host = hostOnly(request.headers.get('host'));
  if (!allowedHost(host))
    return addSecurityHeaders(new NextResponse('Misdirected Request', { status: 421 }), nonce, requestId);

  const origin = request.headers.get('origin');
  if (origin) {
    let originHost: string | undefined;
    try {
      originHost = hostOnly(new URL(origin).host);
    } catch {
      return addSecurityHeaders(new NextResponse('Forbidden origin', { status: 403 }), nonce, requestId);
    }
    if (!allowedHost(originHost))
      return addSecurityHeaders(new NextResponse('Forbidden origin', { status: 403 }), nonce, requestId);
  }

  if (request.nextUrl.pathname.startsWith('/api/') && request.nextUrl.pathname !== '/api/health') {
    const policy = ratePolicy(request.nextUrl.pathname);
    const limited = takeRateLimit(`${policy.name}:${principalKey(request, policy.name)}`, policy.limit);
    if (!limited.allowed) {
      return addSecurityHeaders(
        NextResponse.json(
          {
            error: {
              code: 'RATE_LIMITED',
              message: 'Too many requests. Try again shortly.',
              retryable: true,
              details: { retry_after_s: limited.retry_after_s },
            },
          },
          { status: 429, headers: { 'Retry-After': String(limited.retry_after_s) } },
        ),
        nonce,
        requestId,
        request,
      );
    }
  }

  const methodChangesState = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
  const bearer = request.headers.has('authorization');
  if (methodChangesState && !bearer) {
    const site = request.headers.get('sec-fetch-site');
    if (site && !['same-origin', 'none'].includes(site))
      return addSecurityHeaders(
        new NextResponse('Cross-site request blocked', { status: 403 }),
        nonce,
        requestId,
      );
    if (!origin && !site)
      return addSecurityHeaders(new NextResponse('Origin required', { status: 403 }), nonce, requestId);
    const csrfExempt =
      request.nextUrl.pathname.startsWith('/api/auth/') ||
      (request.nextUrl.pathname === '/api/library/reindex' &&
        request.headers.get('x-kilnry-doctor') === 'reindex');
    if (
      !csrfExempt &&
      !sameSecret(request.cookies.get('kilnry_csrf')?.value, request.headers.get('x-kilnry-csrf'))
    ) {
      return addSecurityHeaders(
        NextResponse.json(
          {
            error: {
              code: 'INVALID_INPUT',
              message: 'CSRF token missing or invalid.',
              retryable: false,
            },
          },
          { status: 403 },
        ),
        nonce,
        requestId,
        request,
      );
    }
  }

  const setup = exchangeSetupToken(request);
  if (setup) return addSecurityHeaders(setup, nonce, requestId, request);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('x-request-id', requestId);
  requestHeaders.set('Content-Security-Policy', `script-src ${scriptSource(nonce)}`);
  return addSecurityHeaders(
    NextResponse.next({ request: { headers: requestHeaders } }),
    nonce,
    requestId,
    request,
  );
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

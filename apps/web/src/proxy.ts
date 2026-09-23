// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { ulid } from '@kilnry/core';
import { defaultDataDir } from '@kilnry/core/config';
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

function allowedHost(host: string | undefined): boolean {
  if (!host) return false;
  if (loopback.has(host)) return true;
  return process.env.KILNRY_LAN === '1' && /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host);
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
  const path = join(defaultDataDir(), 'first-run.token');
  if (!existsSync(path)) return NextResponse.redirect(new URL('/welcome', request.url));
  const age = Date.now() - statSync(path).mtimeMs;
  const expected = readFileSync(path, 'utf8').trim();
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  const valid = age <= 10 * 60_000 && left.length === right.length && timingSafeEqual(left, right);
  if (!valid) return new NextResponse(message('welcome.setupExpired'), { status: 403 });
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

function ratePolicy(path: string): { name: string; limit: number } {
  if (
    path.startsWith('/api/media/') ||
    path.startsWith('/api/thumb/') ||
    path.startsWith('/api/preview/') ||
    path.startsWith('/api/sprite/')
  )
    return { name: 'media', limit: 2000 };
  if (path === '/api/estimate') return { name: 'estimate', limit: 120 };
  if (path === '/api/generate') return { name: 'spend', limit: 60 };
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

function principalKey(request: NextRequest): string {
  const session = request.cookies
    .getAll()
    .filter((cookie) => cookie.name !== 'kilnry_csrf')
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join(';');
  const fallback = `${request.headers.get('x-forwarded-for') ?? 'loopback'}:${request.headers.get('user-agent') ?? ''}`;
  return createHash('sha256')
    .update(session || fallback)
    .digest('hex')
    .slice(0, 24);
}

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
    const limited = takeRateLimit(`${policy.name}:${principalKey(request)}`, policy.limit);
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

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { defaultDataDir } from '@kilnry/core/config';

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

function addSecurityHeaders(response: NextResponse, nonce: string): NextResponse {
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
  if (!response.headers.has('Cache-Control')) response.headers.set('Cache-Control', 'no-store');
  return response;
}

function exchangeSetupToken(request: NextRequest, nonce: string): NextResponse | undefined {
  const supplied = request.nextUrl.searchParams.get('t');
  if (!supplied || request.nextUrl.pathname !== '/welcome') return undefined;
  const path = join(defaultDataDir(), 'first-run.token');
  if (!existsSync(path))
    return addSecurityHeaders(NextResponse.redirect(new URL('/welcome', request.url)), nonce);
  const age = Date.now() - statSync(path).mtimeMs;
  const expected = readFileSync(path, 'utf8').trim();
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  const valid = age <= 10 * 60_000 && left.length === right.length && timingSafeEqual(left, right);
  if (!valid)
    return addSecurityHeaders(
      new NextResponse('This setup link expired. Run pnpm dev again.', { status: 403 }),
      nonce,
    );
  const response = NextResponse.redirect(new URL('/welcome', request.url));
  response.cookies.set('kilnry_setup', '1', { httpOnly: true, sameSite: 'lax', maxAge: 30 * 60, path: '/' });
  return addSecurityHeaders(response, nonce);
}

export function proxy(request: NextRequest): NextResponse {
  const host = hostOnly(request.headers.get('host'));
  if (!allowedHost(host)) return new NextResponse('Misdirected Request', { status: 421 });

  const origin = request.headers.get('origin');
  if (origin) {
    let originHost: string | undefined;
    try {
      originHost = hostOnly(new URL(origin).host);
    } catch {
      return new NextResponse('Forbidden origin', { status: 403 });
    }
    if (!allowedHost(originHost)) return new NextResponse('Forbidden origin', { status: 403 });
  }

  const methodChangesState = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
  const bearer = request.headers.has('authorization');
  if (methodChangesState && !bearer) {
    const site = request.headers.get('sec-fetch-site');
    if (site && !['same-origin', 'none'].includes(site))
      return new NextResponse('Cross-site request blocked', { status: 403 });
    if (!origin && !site) return new NextResponse('Origin required', { status: 403 });
  }

  const nonce = randomBytes(16).toString('base64');
  const setup = exchangeSetupToken(request, nonce);
  if (setup) return setup;
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', `script-src ${scriptSource(nonce)}`);
  return addSecurityHeaders(NextResponse.next({ request: { headers: requestHeaders } }), nonce);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from './api-client';

afterEach(() => {
  document.cookie = 'kilnry_csrf=; Max-Age=0; Path=/';
  vi.unstubAllGlobals();
});

describe('authenticated API client', () => {
  it('copies the CSRF cookie into state-changing requests but not reads', async () => {
    document.cookie = 'kilnry_csrf=fixture-csrf-token; Path=/';
    const requests: RequestInit[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        requests.push(init ?? {});
        return Promise.resolve(new Response('{}', { status: 200 }));
      }),
    );
    await apiFetch('/api/generate', { method: 'POST' });
    await apiFetch('/api/providers');
    expect(new Headers(requests[0]?.headers).get('x-kilnry-csrf')).toBe('fixture-csrf-token');
    expect(new Headers(requests[1]?.headers).has('x-kilnry-csrf')).toBe(false);
  });
});

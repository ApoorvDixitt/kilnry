// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// PRD-15 §Offline: "the job engine marks the network offline when a provider
// request fails with a DNS or connection error and online again when one
// succeeds". Only a completed job marked it online, so one timed-out request
// left the whole process offline until the next job finished — Chat dropped its
// provider tools and the queue kept its waiting label, both wrongly. Seen in the
// m5 shard of run 37550708623, where S-11's deliberate timeout preceded S-24.

import { describe, expect, it } from 'vitest';
import { isNetworkOnline, markNetworkOffline, markNetworkOnline } from '@kilnry/core';
import { requestJson } from './http.js';

describe('the observed network state (F40, PRD-15 §Offline)', () => {
  it('comes back online as soon as a provider answers', async () => {
    markNetworkOffline();
    expect(isNetworkOnline()).toBe(false);

    const answered = await requestJson<{ ok: boolean }>({
      provider: 'fal',
      fetch: async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      url: 'https://queue.fal.run/status',
    });
    expect(answered).toEqual({ ok: true });
    expect(isNetworkOnline()).toBe(true);
  });

  it('counts a refusal as reaching the network, and a dead socket as not', async () => {
    markNetworkOffline();
    await expect(
      requestJson({
        provider: 'fal',
        fetch: async () => new Response('{"detail":"nope"}', { status: 422 }),
        url: 'https://queue.fal.run/submit',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    // A 422 is an answer: the request reached fal.
    expect(isNetworkOnline()).toBe(true);

    await expect(
      requestJson({
        provider: 'fal',
        fetch: async () => {
          throw Object.assign(new TypeError('fetch failed'), {
            cause: Object.assign(new Error('getaddrinfo ENOTFOUND queue.fal.run'), { code: 'ENOTFOUND' }),
          });
        },
        url: 'https://queue.fal.run/submit',
      }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(isNetworkOnline()).toBe(false);
    markNetworkOnline();
  });
});

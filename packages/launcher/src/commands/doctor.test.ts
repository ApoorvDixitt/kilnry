// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestReindex } from './doctor.js';

afterEach(() => vi.unstubAllGlobals());

describe('doctor --reindex', () => {
  it('requests an in-process rebuild over loopback with the doctor guard header', async () => {
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('http://127.0.0.1:3123/api/library/reindex');
      expect(new Headers(init?.headers).get('x-kilnry-doctor')).toBe('reindex');
      return Promise.resolve(
        Response.json({
          ok: true,
          report: { indexed: 42, recovered_from_embedded: 3, skipped: 1 },
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(requestReindex(3123)).resolves.toEqual({
      indexed: 42,
      recovered_from_embedded: 3,
      skipped: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces a connection error with the recovery action', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('connection refused'))),
    );
    await expect(requestReindex(3123)).rejects.toThrow(/Start Kilnry/);
  });
});

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it, vi } from 'vitest';
import { classifyAddress, safeFetch, type ResolvedAddress } from './ssrf.js';

describe('SSRF-safe fetch', () => {
  it.each([
    '0.0.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '100.64.0.1',
    '198.18.0.1',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fe80::1',
    'ff02::1',
    '::ffff:127.0.0.1',
  ])('blocks %s', (address) => {
    expect(classifyAddress(address)).toBe('blocked');
  });

  it.each(['10.0.0.1', '172.16.0.1', '192.168.1.1', 'fc00::1'])('classifies %s as private', (address) => {
    expect(classifyAddress(address)).toBe('private');
  });

  it('rejects credentials, unsafe schemes, ports, and mixed public/private DNS', async () => {
    await expect(safeFetch('https://user:pass@example.test/file')).rejects.toThrow(/credentials/i);
    await expect(safeFetch('file:///etc/passwd')).rejects.toThrow(/HTTPS/i);
    await expect(safeFetch('https://example.test:8443/file')).rejects.toThrow(/port/i);
    await expect(safeFetch('https://[::1]/file')).rejects.toThrow(/blocked address/i);
    const request = vi.fn();
    await expect(
      safeFetch('https://example.test/file', {
        lookup: () =>
          Promise.resolve([
            { address: '93.184.216.34', family: 4 },
            { address: '127.0.0.1', family: 4 },
          ]),
        request,
      }),
    ).rejects.toThrow(/blocked address/i);
    expect(request).not.toHaveBeenCalled();
  });

  it('revalidates every redirect before issuing the next request', async () => {
    const addresses = new Map<string, ResolvedAddress[]>([
      ['public.example', [{ address: '93.184.216.34', family: 4 }]],
      ['metadata.example', [{ address: '169.254.169.254', family: 4 }]],
    ]);
    const request = vi.fn(() =>
      Promise.resolve(
        new Response(null, { status: 302, headers: { Location: 'https://metadata.example/latest' } }),
      ),
    );
    await expect(
      safeFetch('https://public.example/file', {
        lookup: (hostname) => Promise.resolve(addresses.get(hostname) ?? []),
        request,
      }),
    ).rejects.toThrow(/blocked address/i);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('allows explicitly approved LAN HTTP while keeping loopback blocked', async () => {
    const request = vi.fn(() => Promise.resolve(new Response('ok')));
    await expect(
      safeFetch('http://nas.example/file', {
        allow_lan_http: true,
        allow_private_network: true,
        lookup: () => Promise.resolve([{ address: '192.168.1.20', family: 4 }]),
        request,
      }),
    ).resolves.toBeInstanceOf(Response);
    await expect(
      safeFetch('http://localhost/file', {
        allow_lan_http: true,
        allow_private_network: true,
        lookup: () => Promise.resolve([{ address: '127.0.0.1', family: 4 }]),
        request,
      }),
    ).rejects.toThrow(/blocked address/i);
  });
});

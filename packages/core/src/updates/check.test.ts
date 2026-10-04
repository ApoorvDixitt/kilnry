// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { checkForUpdate, compareSemver, manifestUrl } from './check.js';

function manifestFetch(body: unknown, ok = true): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), { status: ok ? 200 : 404 })) as unknown as typeof fetch;
}

describe('update check (F-SET-07)', () => {
  it('orders semver cores and ignores a pre-release suffix', () => {
    expect(compareSemver('1.1.0', '1.0.0')).toBeGreaterThan(0);
    expect(compareSemver('0.5.0', '0.5.0')).toBe(0);
    expect(compareSemver('1.0.0-beta.1', '1.0.0')).toBe(0);
    expect(compareSemver('0.4.1', '0.5.0')).toBeLessThan(0);
  });

  it('reads the channel-specific manifest path', () => {
    expect(manifestUrl('https://x/releases', 'stable')).toBe(
      'https://x/releases/latest/download/manifest.json',
    );
    expect(manifestUrl('https://x/releases/', 'beta')).toBe('https://x/releases/download/beta/manifest.json');
  });

  it('reports up to date when the manifest version is not newer', async () => {
    const state = await checkForUpdate({
      fetch: manifestFetch({ version: '0.5.0' }),
      currentVersion: '0.5.0',
    });
    expect(state.status).toBe('up_to_date');
  });

  it('reports an available update with its notes and release date', async () => {
    const state = await checkForUpdate({
      fetch: manifestFetch({ version: '0.6.0', released_at: '2026-10-10', notes: '## New\n- things' }),
      currentVersion: '0.5.0',
    });
    expect(state.status).toBe('available');
    if (state.status === 'available') {
      expect(state.latest).toBe('0.6.0');
      expect(state.notes).toContain('things');
      expect(state.released_at).toBe('2026-10-10');
    }
  });

  it('reports offline when the manifest cannot be read, never a user error', async () => {
    const thrower = (async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    }) as unknown as typeof fetch;
    const state = await checkForUpdate({ fetch: thrower, currentVersion: '0.5.0' });
    expect(state.status).toBe('offline');
    const notFound = await checkForUpdate({
      fetch: manifestFetch({}, false),
      currentVersion: '0.5.0',
    });
    expect(notFound.status).toBe('offline');
  });
});

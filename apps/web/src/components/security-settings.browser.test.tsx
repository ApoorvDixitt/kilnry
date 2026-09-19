// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SecuritySettings } from './security-settings';

let root: Root | undefined;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

// The Security page loads four read endpoints on mount; this stub answers each
// with a minimal, valid body so the audit-log section can be asserted.
function stubFetch(events: Array<{ id: string; actor: string; action: string; target: string }>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/security/key-store'))
        return Promise.resolve(
          Response.json({
            status: { initialized: true, locked: false, source: 'keychain', weaker_machine_key: false },
          }),
        );
      if (url.includes('/api/security/network'))
        return Promise.resolve(Response.json({ configured: false, active: false, restart_required: false }));
      if (url.includes('/api/security/sessions')) return Promise.resolve(Response.json({ sessions: [] }));
      if (url.includes('/api/security/audit'))
        return Promise.resolve(
          Response.json({
            events: events.map((event) => ({ ...event, created_at: '2026-09-19T12:00:00.000Z' })),
          }),
        );
      return Promise.resolve(Response.json({}));
    }),
  );
}

async function render(): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<SecuritySettings />);
  });
  // Let the four mount fetches settle and their state updates flush.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  return host;
}

describe('SecuritySettings audit log', () => {
  it('lists recorded security events with action, actor and target', async () => {
    stubFetch([
      { id: '1', actor: 'user:owner', action: 'budget.override', target: 'auto' },
      { id: '2', actor: 'user:owner', action: 'session.revoke', target: 'sess-1' },
    ]);
    const host = await render();
    const table = host.querySelector('.audit-table');
    expect(table).not.toBeNull();
    const override = host.querySelector('[data-action="budget.override"]');
    expect(override).not.toBeNull();
    expect(override?.textContent).toContain('budget.override');
    expect(override?.textContent).toContain('user:owner');
    expect(override?.textContent).toContain('auto');
    // The export control is available once events are present.
    expect(host.querySelector('.audit-card-head button')?.hasAttribute('disabled')).toBe(false);
  });

  it('shows an empty note when no events are recorded', async () => {
    stubFetch([]);
    const host = await render();
    expect(host.querySelector('.audit-empty')).not.toBeNull();
    expect(host.querySelector('.audit-table')).toBeNull();
  });
});

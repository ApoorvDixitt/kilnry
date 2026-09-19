// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppearanceSettings } from './appearance-settings';

let root: Root | undefined;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-density');
  document.documentElement.removeAttribute('data-motion');
  localStorage.clear();
  vi.unstubAllGlobals();
});

async function render(): Promise<HTMLElement> {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <AppearanceSettings
        initialValue={{ theme: 'system', density: 'comfortable', reduced_motion: 'system' }}
      />,
    );
  });
  return host;
}

async function choose(host: HTMLElement, value: string): Promise<void> {
  await act(async () => {
    host.querySelector<HTMLInputElement>(`input[value="${value}"]`)!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('Appearance settings', () => {
  it('applies and persists theme, density, and reduced motion without a reload', async () => {
    const requests: RequestInit[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        requests.push(init ?? {});
        return Promise.resolve(Response.json({ appearance: JSON.parse(String(init?.body)) }));
      }),
    );
    const host = await render();

    await choose(host, 'dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('kilnry-theme')).toBe('dark');

    await choose(host, 'compact');
    expect(document.documentElement.dataset.density).toBe('compact');

    await choose(host, 'reduce');
    expect(document.documentElement.dataset.motion).toBe('reduced');
    expect(requests).toHaveLength(3);
    expect(JSON.parse(String(requests[2]?.body))).toEqual({
      theme: 'dark',
      density: 'compact',
      reduced_motion: 'reduce',
    });
    expect(host.textContent).toContain('Green means money in Kilnry');
  });

  it('restores the previous appearance and surfaces a save error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(Response.json({ error: { message: 'Disk is read-only.' } }, { status: 500 })),
      ),
    );
    const host = await render();
    await choose(host, 'dark');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Disk is read-only.');
  });
});

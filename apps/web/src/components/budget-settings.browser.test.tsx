// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BudgetSettings } from './budget-settings';

let root: Root | undefined;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

async function render(): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<BudgetSettings />);
    await Promise.resolve();
  });
  return host;
}

describe('BudgetSettings', () => {
  it('loads existing caps and saves each scope through the budget route', async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'PUT') {
          requests.push({ url, body: JSON.parse(String(init.body)) });
          return Promise.resolve(Response.json({ budgets: [] }));
        }
        return Promise.resolve(
          Response.json({
            budgets: [{ scope: 'daily', cap_usd: 10, spent_usd: 3, behavior: 'block' }],
          }),
        );
      }),
    );
    const host = await render();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const daily = host.querySelector('.budget-input input') as HTMLInputElement;
    expect(daily.value).toBe('10');

    await act(async () => {
      const form = host.querySelector('form') as HTMLFormElement;
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(requests.some((r) => (r.body as { scope: string }).scope === 'daily')).toBe(true);
    expect(requests.some((r) => (r.body as { scope: string }).scope === 'monthly')).toBe(true);
    expect(host.querySelector('.budget-status')?.textContent).toContain('saved');
  });
});

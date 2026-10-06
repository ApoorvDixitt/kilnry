// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BudgetMeter } from './budget-meter';

let root: Root | undefined;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function stubBudget(budgets: Array<{ scope: string; cap_usd: number; spent_usd: number }>): string[] {
  const urls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify({ budgets }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return urls;
}

async function render(node: React.ReactNode): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
  return host;
}

describe('the budget meter (F-17, F-PRV-04)', () => {
  it("shows today's spend against the daily cap, fills the bar, and the month on hover", async () => {
    stubBudget([
      { scope: 'daily', cap_usd: 10, spent_usd: 3.1 },
      { scope: 'monthly', cap_usd: 100, spent_usd: 42.5 },
    ]);
    const host = await render(<BudgetMeter />);
    expect(host.querySelector('.budget-meter-text')?.textContent).toBe('Today $3.10 / $10.00');
    expect((host.querySelector('.budget-meter b') as HTMLElement).style.width).toBe('31%');
    expect(host.querySelector('.budget-meter')?.getAttribute('title')).toBe('This month $42.50 / $100.00');
  });

  it('writes a cap of one cent the PRD way and never overfills', async () => {
    stubBudget([{ scope: 'daily', cap_usd: 0.01, spent_usd: 0.014 }]);
    const host = await render(<BudgetMeter />);
    expect(host.querySelector('.budget-meter-text')?.textContent).toBe('Today $0.01 / $0.01');
    expect((host.querySelector('.budget-meter b') as HTMLElement).style.width).toBe('100%');
  });

  it('says there is no daily cap when the user blanked it, and re-reads on a refresh', async () => {
    const urls = stubBudget([]);
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(<BudgetMeter refreshKey={0} />));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(host.querySelector('.budget-meter-label')?.textContent).toBe('No daily cap');
    await act(async () => root!.render(<BudgetMeter refreshKey={1} />));
    expect(urls.filter((url) => url === '/api/budget')).toHaveLength(2);
  });
});

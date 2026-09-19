// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CostStrip,
  costStripState,
  formatEta,
  outputSize,
  type BudgetLine,
  type CostEstimate,
} from './cost-strip';

let root: Root | undefined;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = new Date('2026-09-19T00:00:00.000Z').getTime();

function estimate(overrides: Partial<CostEstimate> = {}): CostEstimate {
  return {
    estimate_usd: 0.84,
    source: 'formula',
    unit_price: { unit: 'second', amount_usd: 0.168, fetched_at: '2026-09-17T00:00:00.000Z' },
    breakdown: [{ label: '$0.168/s x 5 s x 1', usd: 0.84 }],
    eta_s: 90,
    ...overrides,
  };
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

async function render(props: Parameters<typeof CostStrip>[0]): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<CostStrip {...props} />));
  return host;
}

describe('formatEta', () => {
  it('shows seconds under 90 and minutes above', () => {
    expect(formatEta(12)).toBe('~12 s');
    expect(formatEta(150)).toBe('~3 min');
  });
});

describe('outputSize', () => {
  it('describes seconds, characters, and images', () => {
    expect(outputSize('second', { count: 1, duration_s: 5 }, 0)).toBe('5 s');
    expect(outputSize('character', { count: 1 }, 620)).toBe('620 chars');
    expect(outputSize('image', { count: 1 }, 0)).toBe('1 image');
    expect(outputSize('image', { count: 4 }, 0)).toBe('4 images');
  });
});

describe('costStripState', () => {
  it('blocks generation when there is no price', () => {
    const state = costStripState({ estimate: null, now: NOW });
    expect(state).toMatchObject({ status: 'unpriced', blocked: true });
  });

  it('prefers an authoritative amount and never blocks a priced, in-budget estimate', () => {
    const state = costStripState({
      estimate: estimate({ authoritative_usd: 0.9, source: 'provider' }),
      now: NOW,
    });
    expect(state).toMatchObject({ blocked: false, amount: 0.9, authoritative: true, status: 'ok' });
  });

  it('turns over budget and blocks when the estimate would pass a cap', () => {
    const budgets: BudgetLine[] = [{ scope: 'daily', label: 'Today', cap_usd: 10, spent_usd: 9.62 }];
    const state = costStripState({ estimate: estimate({ estimate_usd: 0.84 }), budgets, now: NOW });
    expect(state).toMatchObject({ status: 'over-budget', blocked: true });
    expect(state.overBudget?.scope).toBe('daily');
  });

  it('marks a price older than thirty days as stale but does not block', () => {
    const state = costStripState({
      estimate: estimate({
        unit_price: { unit: 'second', amount_usd: 0.1, fetched_at: '2026-07-01T00:00:00.000Z' },
      }),
      now: NOW,
    });
    expect(state).toMatchObject({ status: 'stale', blocked: false });
  });
});

describe('CostStrip', () => {
  it('shows the approximate marker for a formula estimate with size and ETA', async () => {
    const host = await render({
      estimate: estimate(),
      params: { count: 1, duration_s: 5 },
      promptChars: 0,
      now: NOW,
    });
    expect(host.querySelector('.cost-strip-figure')?.textContent).toBe('≈ $0.840');
    expect(host.querySelector('.cost-strip-size')?.textContent).toBe('5 s');
    expect(host.querySelector('.cost-strip-eta')?.textContent).toBe('~90 s');
  });

  it('drops the approximate marker when the provider gave an authoritative price', async () => {
    const host = await render({
      estimate: estimate({ authoritative_usd: 0.9, source: 'provider' }),
      params: { count: 1, duration_s: 5 },
      promptChars: 0,
      now: NOW,
    });
    expect(host.querySelector('.cost-strip-figure')?.textContent).toBe('$0.900');
  });

  it('renders the exact over-budget copy and marks the strip', async () => {
    const host = await render({
      estimate: estimate({ estimate_usd: 0.84 }),
      params: { count: 1, duration_s: 5 },
      promptChars: 0,
      budgets: [{ scope: 'daily', label: 'Today', cap_usd: 10, spent_usd: 9.62 }],
      now: NOW,
    });
    expect(host.querySelector('.cost-strip')?.getAttribute('data-status')).toBe('over-budget');
    expect(host.querySelector('.cost-strip-block')?.textContent).toBe(
      'Daily cap $10.00 reached ($9.62 spent). Raise the cap or wait until midnight.',
    );
  });

  it('shows the unpriced copy and no figure when there is no estimate', async () => {
    const host = await render({ estimate: null, params: { count: 1 }, promptChars: 0, now: NOW });
    expect(host.querySelector('.cost-strip')?.getAttribute('data-status')).toBe('unpriced');
    expect(host.textContent).toContain('Refresh prices in Settings');
  });
});

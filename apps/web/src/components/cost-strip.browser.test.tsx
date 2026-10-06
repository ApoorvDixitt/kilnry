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
import { makeEstimate } from '../test/composer-fixtures';

let root: Root | undefined;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = new Date('2026-09-19T00:00:00.000Z').getTime();

function estimate(overrides: Partial<CostEstimate> = {}): CostEstimate {
  return makeEstimate(overrides);
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
        unit_price: {
          unit: 'second',
          amount_usd: 0.1,
          fetched_at: '2026-07-01T00:00:00.000Z',
          source_url: 'https://example.com/price',
        },
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
    expect(host.querySelector('.cost-strip-figure-text')?.textContent).toBe('≈ $0.840');
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
    expect(host.querySelector('.cost-strip-figure-text')?.textContent).toBe('$0.900');
  });

  it('renders an animated figure that is hidden from assistive technology', async () => {
    const host = await render({
      estimate: estimate(),
      params: { count: 1, duration_s: 5 },
      promptChars: 0,
      now: NOW,
    });
    const roll = host.querySelector('.cost-strip-figure-roll');
    expect(roll).not.toBeNull();
    expect(roll?.getAttribute('aria-hidden')).toBe('true');
    expect(roll?.querySelector('number-flow-react')).not.toBeNull();
    // The accessible amount lives in a visually-hidden live region.
    expect(host.querySelector('.cost-strip-figure-text.visually-hidden')).not.toBeNull();
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

  // UX-03: the strip used to blame stale prices and send the user to Settings
  // whenever there was no estimate, including before they typed anything.
  it('says what is actually true in each no-estimate state', async () => {
    const empty = await render({
      estimate: null,
      params: { count: 1 },
      promptChars: 0,
      now: NOW,
      promptEmpty: true,
    });
    expect(empty.querySelector('.cost-strip')?.getAttribute('data-status')).toBe('unpriced');
    expect(empty.textContent).toBe('Type a prompt to see the price.');
    await act(async () => root?.unmount());

    const pricing = await render({
      estimate: null,
      params: { count: 1 },
      promptChars: 12,
      now: NOW,
      pricing: true,
    });
    expect(pricing.textContent).toBe('Pricing…');
    await act(async () => root?.unmount());

    const failed = await render({
      estimate: null,
      params: { count: 1 },
      promptChars: 12,
      now: NOW,
      priceError: 'No connected provider can do this.',
    });
    expect(failed.textContent).toBe('No connected provider can do this.');
  });

  // PRD-14 §8 as amended by D-71a: the stale state names the model and its age
  // and offers the refresh and the per-action override.
  it('names the model and the age on a stale price, with both actions', async () => {
    const refreshes: number[] = [];
    const overrides: number[] = [];
    const host = await render({
      estimate: estimate({
        unit_price: {
          unit: 'image',
          amount_usd: 0.04,
          fetched_at: '2026-08-01T00:00:00.000Z',
          source_url: 'https://example.com/price',
        },
      }),
      params: { count: 1 },
      promptChars: 12,
      now: NOW,
      onRefreshPrices: () => refreshes.push(1),
      onUseStalePrice: () => overrides.push(1),
    });
    expect(host.querySelector('.cost-strip')?.getAttribute('data-status')).toBe('stale');
    expect(host.querySelector('[data-testid="cost-strip-stale"]')?.textContent).toBe(
      'Price data for fal-ai/example is 49 days old.',
    );
    await act(async () => host.querySelector<HTMLButtonElement>('.cost-strip-refresh')!.click());
    await act(async () => host.querySelector<HTMLButtonElement>('.cost-strip-use-stale')!.click());
    expect([refreshes.length, overrides.length]).toEqual([1, 1]);
  });

  // UX-19: a video strip read "0 s" before the duration chip was touched while
  // the engine priced the model's minimum.
  it('shows the duration the engine priced until the user picks one', () => {
    expect(outputSize('second', { count: 1 }, 0, 3)).toBe('3 s');
    expect(outputSize('second', { count: 1, duration_s: 8 }, 0, 3)).toBe('8 s');
    expect(outputSize('second', { count: 2, duration_s: 5 }, 0)).toBe('10 s');
  });

  // F-19: the strip said "Daily cap … wait until midnight." for every scope, so a
  // monthly or folder cap was misreported — the engine's own error varies both.
  it('names the cap that was hit and when it frees up', async () => {
    const host = await render({
      estimate: estimate(),
      params: { count: 1 },
      promptChars: 12,
      now: NOW,
      budgets: [{ scope: 'monthly', label: 'This month', cap_usd: 100, spent_usd: 99.9, behavior: 'block' }],
    });
    expect(host.querySelector('.cost-strip-block')?.textContent).toBe(
      'Monthly cap $100.00 reached ($99.90 spent). Raise the cap or wait until the first of next month.',
    );
    await act(async () => root?.unmount());
    const folder = await render({
      estimate: estimate(),
      params: { count: 1 },
      promptChars: 12,
      now: NOW,
      budgets: [{ scope: 'folder', label: 'Client_A', cap_usd: 5, spent_usd: 4.99, behavior: 'block' }],
    });
    expect(folder.querySelector('.cost-strip-block')?.textContent).toBe(
      'Client_A cap $5.00 reached ($4.99 spent). Raise the cap or wait until you raise the cap.',
    );
  });

  // F-19 as amended by A.4: the cap-stop sentence formats money PRD-14's way.
  it('writes a one-cent cap as $0.01, not $0.010', async () => {
    const host = await render({
      estimate: estimate({ estimate_usd: 0.01 }),
      params: { count: 1 },
      promptChars: 12,
      now: NOW,
      budgets: [{ scope: 'daily', label: 'Today', cap_usd: 0.01, spent_usd: 0.01, behavior: 'block' }],
    });
    expect(host.querySelector('.cost-strip-block')?.textContent).toBe(
      'Daily cap $0.01 reached ($0.01 spent). Raise the cap or wait until midnight.',
    );
  });
});

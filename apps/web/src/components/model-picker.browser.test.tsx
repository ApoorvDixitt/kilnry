// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { ModelPicker, formatPrice, isOfferable, priceAgeDays, type PickerModel } from './model-picker';
import { makeModel } from '../test/composer-fixtures';

let root: Root | undefined;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = new Date('2026-09-19T00:00:00.000Z').getTime();

function model(overrides: Partial<PickerModel>): PickerModel {
  return makeModel(overrides);
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

async function render(props: Parameters<typeof ModelPicker>[0]): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<ModelPicker {...props} />);
  });
  return host;
}

describe('formatPrice', () => {
  it('shows the unit suffix and scales per-character prices to 1k', () => {
    expect(formatPrice({ unit: 'image', amount_usd: 0.15 })).toBe('$0.150/img');
    expect(formatPrice({ unit: 'second', amount_usd: 0.168 })).toBe('$0.168/s');
    expect(formatPrice({ unit: 'character', amount_usd: 0.00005 })).toBe('$0.050/1k chars');
  });
});

describe('isOfferable', () => {
  it('hides deprecated models and hidden expensive routes', () => {
    expect(isOfferable(model({}))).toBe(true);
    expect(isOfferable(model({ deprecated_at: '2026-01-01T00:00:00.000Z' }))).toBe(false);
    expect(isOfferable(model({ tags: ['hidden_expensive_route'] }))).toBe(false);
  });
});

describe('priceAgeDays', () => {
  it('counts whole days since the price was fetched', () => {
    expect(priceAgeDays('2026-09-17T00:00:00.000Z', NOW)).toBe(2);
    expect(priceAgeDays('2026-08-01T00:00:00.000Z', NOW)).toBe(49);
  });
});

describe('ModelPicker', () => {
  it('lists Auto first with a live explanation and every priced row shows its unit', async () => {
    const host = await render({
      mode: 'image',
      models: [
        model({
          model_id: 'a',
          display_name: 'Cheap',
          price: { unit: 'image', amount_usd: 0.02, fetched_at: '2026-09-18T00:00:00.000Z' },
        }),
        model({
          model_id: 'b',
          display_name: 'Pricey',
          price: { unit: 'image', amount_usd: 0.5, fetched_at: '2026-09-18T00:00:00.000Z' },
        }),
      ],
      selectedId: 'auto',
      autoWhy: 'Now: Cheap on fal ($0.02/img).',
      onSelect: () => {},
      now: NOW,
    });

    const options = host.querySelectorAll('[role="option"]');
    expect(options[0]?.textContent).toContain('Auto');
    expect(host.querySelector('.model-picker-why')?.textContent).toBe('Now: Cheap on fal ($0.02/img).');
    const prices = [...host.querySelectorAll('.model-row-price')].map((el) => el.textContent);
    expect(prices.every((text) => /\/img$/.test(text ?? ''))).toBe(true);
  });

  it('never renders a model that has no price and logs nothing to the user', async () => {
    const host = await render({
      mode: 'image',
      models: [model({ model_id: 'priced' }), model({ model_id: 'unpriced', price: undefined })],
      selectedId: 'auto',
      autoWhy: '',
      onSelect: () => {},
      now: NOW,
    });
    const rows = [...host.querySelectorAll('.model-row:not(.model-row-auto)')];
    expect(rows).toHaveLength(1);
  });

  it('excludes deprecated and hidden models even when searched', async () => {
    const host = await render({
      mode: 'image',
      models: [
        model({ model_id: 'live', display_name: 'Live model' }),
        model({ model_id: 'sora', display_name: 'Sora', deprecated_at: '2026-01-01T00:00:00.000Z' }),
        model({ model_id: 'seedance', display_name: 'Seedance fal', tags: ['hidden_expensive_route'] }),
      ],
      selectedId: 'auto',
      autoWhy: '',
      onSelect: () => {},
      now: NOW,
    });
    expect(host.textContent).toContain('Live model');
    expect(host.textContent).not.toContain('Sora');
    expect(host.textContent).not.toContain('Seedance fal');
  });

  it('shows a disconnected model as an Add-key link into Provider settings', async () => {
    const host = await render({
      mode: 'video',
      models: [
        model({
          provider: 'higgsfield',
          model_id: 'hf',
          display_name: 'HF',
          capabilities: ['text2video'],
          connected: false,
        }),
      ],
      selectedId: 'auto',
      autoWhy: '',
      onSelect: () => {},
      now: NOW,
    });
    const link = host.querySelector('.model-row-missing');
    expect(link?.getAttribute('href')).toBe('/settings/providers');
    expect(link?.textContent).toContain('Add Higgsfield key');
  });

  it('marks a price older than thirty days as stale', async () => {
    const host = await render({
      mode: 'image',
      models: [
        model({
          model_id: 'old',
          price: { unit: 'image', amount_usd: 0.1, fetched_at: '2026-07-01T00:00:00.000Z' },
        }),
      ],
      selectedId: 'auto',
      autoWhy: '',
      onSelect: () => {},
      now: NOW,
    });
    expect(host.querySelector('.model-row-stale')).not.toBeNull();
  });

  it('selects Auto and a model through the callback', async () => {
    const picks: Array<string> = [];
    const host = await render({
      mode: 'image',
      models: [model({ model_id: 'pickme', display_name: 'Pick me' })],
      selectedId: 'auto',
      autoWhy: '',
      onSelect: (id) => picks.push(id),
      now: NOW,
    });
    await act(async () => {
      host.querySelectorAll<HTMLButtonElement>('.model-row')[1]?.click();
    });
    expect(picks).toEqual(['pickme']);
  });
});

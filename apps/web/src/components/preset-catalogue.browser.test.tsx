// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  categoryLabel,
  costLabel,
  emptyLabel,
  matchesQuery,
  PRESET_TABS,
  PresetCatalogue,
  visiblePresets,
  type PresetCardRow,
} from './preset-catalogue';

let root: Root | undefined;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

async function render(node: React.ReactNode): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
  return host;
}

function row(overrides: Partial<PresetCardRow> = {}): PresetCardRow {
  return {
    id: 'kilnry.product.ice-cube-splash',
    name: 'Ice Cube Splash',
    category: 'product_shot',
    description: 'Hero product frozen mid-splash with ice and water.',
    tags: ['beverage', 'splash'],
    kind: 'image_edit',
    model_label: 'Seedream 4.5',
    model_tooltip: 'Prefers Seedream 4.5 on fal · alternates: Nano Banana 2',
    cost_usd: 0.04,
    cost_unit: 'image',
    needs: ['fal', 'openrouter'],
    price_stale: false,
    enabled: true,
    path: '/tmp/kilnry.product.ice-cube-splash.json',
    source: 'seed',
    ...overrides,
  };
}

describe('the preset catalogue (F-PRE-01)', () => {
  it('offers the nine tabs in the specified order', () => {
    expect(PRESET_TABS.map((tab) => tab.label)).toEqual([
      'All',
      'UGC',
      'Product shot',
      'Motion',
      'Ads',
      'Posters',
      'Camera',
      'Styles',
      'Thumbnails',
    ]);
  });

  it('labels a category the way the tabs do', () => {
    expect(categoryLabel('product_shot')).toBe('Product shot');
    expect(categoryLabel('thumbnails')).toBe('Thumbnails');
  });

  it('writes the indicative cost with its unit', () => {
    expect(costLabel(row())).toBe('≈ $0.04 · 1 image');
    expect(costLabel(row({ kind: 'video', cost_unit: 'clip', cost_usd: 0.42 }))).toBe(
      '≈ $0.42 · per clip 5 s',
    );
  });

  it('says so plainly when a preset carries no indicative price', () => {
    const unpriced = row();
    delete unpriced.cost_usd;
    expect(costLabel(unpriced)).toBe('Price not set');
  });

  it('searches the name, the description, the tags and the model', () => {
    expect(matchesQuery(row(), 'ice cube')).toBe(true);
    expect(matchesQuery(row(), 'seedream')).toBe(true);
    expect(matchesQuery(row(), 'splash')).toBe(true);
    expect(matchesQuery(row(), 'mid-splash')).toBe(true);
    expect(matchesQuery(row(), 'claymation')).toBe(false);
    expect(matchesQuery(row(), '   ')).toBe(true);
  });

  it('shows one category on its own tab and everything on All', () => {
    const rows = [row(), row({ id: 'kilnry.style.claymation', category: 'styles', name: 'Claymation' })];
    expect(visiblePresets(rows, 'all', '').length).toBe(2);
    expect(visiblePresets(rows, 'styles', '').map((entry) => entry.name)).toEqual(['Claymation']);
    expect(visiblePresets(rows, 'posters', '')).toEqual([]);
  });

  it('names the tab in the empty line', () => {
    expect(emptyLabel('posters')).toBe('No posters yet. Add one below.');
    expect(emptyLabel('all')).toBe('No presets yet. Add one below.');
  });

  it('draws a card with its name, category, model, cost and Use button', async () => {
    const host = await render(<PresetCatalogue initial={[row()]} />);
    const card = host.querySelector('.preset-card');
    expect(card).not.toBeNull();
    expect(card?.querySelector('.preset-name')?.textContent).toBe('Ice Cube Splash');
    expect(card?.querySelector('.preset-meta')?.textContent).toBe('Product shot · Seedream 4.5');
    expect(card?.querySelector('.preset-cost')?.textContent).toContain('≈ $0.04');
    expect(card?.querySelector('.preset-use-button')?.textContent).toBe('Use');
    expect(card?.querySelector('.preset-needs-badge')).toBeNull();
    expect(card?.querySelector('.preset-stale-dot')).toBeNull();
  });

  it('badges a preset whose provider key is missing but still draws the card', async () => {
    const host = await render(<PresetCatalogue initial={[row({ missing_provider: 'fal' })]} />);
    expect(host.querySelector('.preset-needs-badge')?.textContent).toBe('Needs fal key');
    expect(host.querySelector('.preset-card')).not.toBeNull();
  });

  it('marks a stale price with a dot beside the cost', async () => {
    const host = await render(<PresetCatalogue initial={[row({ price_stale: true })]} />);
    expect(host.querySelector('.preset-cost .preset-stale-dot')).not.toBeNull();
  });

  it('replaces an unreadable file with a row that names the problem', async () => {
    const host = await render(
      <PresetCatalogue
        initial={[row({ enabled: false, id: 'ugc-hook', issue: 'slots[0].type is not a slot type' })]}
      />,
    );
    const invalid = host.querySelector('.preset-card.is-invalid');
    expect(invalid?.textContent).toBe('ugc-hook.json: slots[0].type is not a slot type');
    expect(invalid?.getAttribute('role')).toBe('alert');
  });

  it('shows the footer hint about adding a preset', async () => {
    const host = await render(<PresetCatalogue initial={[row()]} />);
    expect(host.querySelector('.preset-footer')?.textContent).toBe(
      'Add a preset: drop a .json here, paste a URL, or open the presets folder.',
    );
  });

  it('offers a tab for every category and marks the chosen one', async () => {
    const host = await render(<PresetCatalogue initial={[row()]} />);
    const tabs = [...host.querySelectorAll('.preset-tab')];
    expect(tabs.length).toBe(9);
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    await act(async () => (tabs[5] as HTMLButtonElement).click());
    expect(host.querySelectorAll('.preset-tab')[5]?.getAttribute('aria-selected')).toBe('true');
    // The product-shot card is not a poster, so the poster tab is empty.
    expect(host.querySelector('.preset-empty')?.textContent).toBe('No posters yet. Add one below.');
  });
});

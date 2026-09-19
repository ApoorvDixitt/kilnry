// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssetGrid, columnsForWidth } from './asset-grid';
import type { AssetListItem } from '../lib/composer-types';

let root: Root | undefined;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function asset(overrides: Partial<AssetListItem> = {}): AssetListItem {
  return {
    id: crypto.randomUUID(),
    path: 'inbox/example.png',
    folder_path: 'inbox',
    kind: 'image',
    mime: 'image/png',
    width: 1024,
    height: 1024,
    duration_s: null,
    has_audio: null,
    provider_id: 'fal',
    actual_usd: 0.15,
    estimate_usd: 0.15,
    sidecar_ok: true,
    created_at: '2026-09-19T00:00:00.000Z',
    ...overrides,
  };
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

async function render(props: Parameters<typeof AssetGrid>[0]): Promise<HTMLElement> {
  const host = document.createElement('div');
  host.style.height = '600px';
  host.style.width = '900px';
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<AssetGrid {...props} />));
  return host;
}

describe('columnsForWidth', () => {
  it('fits more tiles as the container widens and never returns zero', () => {
    expect(columnsForWidth(0)).toBe(1);
    expect(columnsForWidth(200)).toBe(1);
    expect(columnsForWidth(900)).toBeGreaterThanOrEqual(4);
    expect(columnsForWidth(1880)).toBeGreaterThan(columnsForWidth(900));
  });
});

describe('AssetGrid', () => {
  const base = {
    assets: [asset(), asset({ kind: 'video', duration_s: 5 })],
    sort: 'newest' as const,
    view: 'grid' as const,
    onSortChange: () => {},
    onViewChange: () => {},
    onOpen: () => {},
  };

  it('shows the item count and sort control', async () => {
    const host = await render(base);
    expect(host.querySelector('.asset-count')?.textContent).toBe('2 items');
    expect(host.querySelector('.asset-sort select')).not.toBeNull();
  });

  it('switches to list columns through the view toggle', async () => {
    const changes: string[] = [];
    const host = await render({ ...base, onViewChange: (v) => changes.push(v) });
    const listButton = [...host.querySelectorAll('.asset-view-toggle button')].find(
      (b) => b.textContent === 'List',
    ) as HTMLButtonElement;
    await act(async () => listButton.click());
    expect(changes).toEqual(['list']);
  });

  it('opens an asset when a tile is clicked', async () => {
    const opened: string[] = [];
    const target = asset({ id: 'open-me' });
    const host = await render({ ...base, assets: [target], onOpen: (id) => opened.push(id) });
    const tile = host.querySelector('.asset-tile') as HTMLButtonElement;
    await act(async () => tile.click());
    expect(opened).toEqual(['open-me']);
  });

  it('marks assets without a sidecar with the orphan outline', async () => {
    const host = await render({ ...base, assets: [asset({ sidecar_ok: false })] });
    expect(host.querySelector('.asset-tile.is-orphan')).not.toBeNull();
  });

  it('does not start hover-scrub under reduced motion', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    const host = await render({ ...base, assets: [asset({ kind: 'video', id: 'v1', duration_s: 5 })] });
    const tile = host.querySelector('.asset-tile') as HTMLButtonElement;
    await act(async () => {
      tile.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    const img = tile.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toContain('/api/thumb/');
    vi.unstubAllGlobals();
  });
});

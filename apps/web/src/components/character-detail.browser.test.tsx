// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// F-112: "Build sheet" started a paid run with one click and no price. PRD-07:278:
// it opens the Character Sheet workflow intake prefilled with this Character,
// and the button shows the estimate: "Build sheet · ≈ $0.83".

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CharacterDetail } from './character-detail';

// next/link reads Node's process.env at import; the browser has no process.
vi.hoisted(() => {
  const scope = globalThis as unknown as { process?: { env: Record<string, string> } };
  scope.process ??= { env: {} };
});

let root: Root | undefined;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

const item = {
  handle: 'maya',
  display_name: 'Maya',
  version: 1,
  versions: [{ version: 1, frozen: false, current: true, jobs: 0 }],
  tags: [],
  is_real_person: false,
  consent: { status: 'n/a' },
  minor_suspected: false,
  appearance: { descriptor: 'A calm ceramicist.', anchors: [], negative_traits: [] },
  references: [],
  trained_identities: [],
  stats: { usage_count: 0 },
};

const workflow = {
  id: 'kilnry-character-sheet',
  name: 'Character sheet',
  description: 'Turnaround, expressions and outfits for one Character.',
  inputs: {
    type: 'object',
    required: ['character'],
    properties: {
      character: {
        type: 'string',
        description: '@handle',
        'x-kilnry': { widget: 'character', kinds: ['character'] },
      },
    },
  },
};

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

async function settle(): Promise<void> {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
}

describe('Build sheet on the Character page (F-112, F-CHR-04)', () => {
  it('carries the sheet price and opens the prefilled intake instead of starting a run', async () => {
    const actions: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url === '/api/characters/manage') {
        const action = (JSON.parse(String(init?.body ?? '{}')) as { action?: string }).action ?? '';
        actions.push(action);
        if (action === 'price_sheet') return json({ estimate_usd: 0.83, generate_steps: 4 });
        return json({});
      }
      if (url.startsWith('/api/characters/maya')) return json({ item, assets: [] });
      if (url.startsWith('/api/workflows/kilnry-character-sheet')) return json({ workflow });
      return json({});
    });
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(<CharacterDetail handle="maya" />));
    await settle();

    const button = host.querySelector('.character-build-sheet') as HTMLButtonElement;
    expect(button.textContent).toBe('Build sheet · ≈ $0.83');
    await act(async () => button.click());
    await settle();

    const drawer = host.querySelector('aside.workflow-drawer') as HTMLElement | null;
    expect(drawer?.dataset.workflowId).toBe('kilnry-character-sheet');
    const character = drawer?.querySelector('[data-widget="character"]') as HTMLInputElement | null;
    expect(character?.value).toBe('@maya');
    // Nothing was started: the only manage call was the free price.
    expect(actions).toEqual(['price_sheet']);
  });
});

// F-113: PRD-07:580 designs the Usage tab as the Character's cost and usage
// report — "312 assets · $41.20 spent · avg consistency: high (opt-in check)",
// the version/type/strategy filters and "Open in Library". It rendered a
// thumbnail strip and nothing else.
describe('the Usage tab (F-CHR-11, PRD-07:580)', () => {
  const usageItem = { ...item, stats: { usage_count: 2, avg_consistency: 0.86 } };
  const usage = [
    {
      asset_id: 'a1',
      path: 'inbox/a1.png',
      preview_url: '/api/thumb/a1',
      kind: 'image',
      version: 1,
      strategy: 'references',
      actual_usd: 0.04,
    },
    {
      asset_id: 'a2',
      path: 'inbox/a2.mp4',
      preview_url: '/api/thumb/a2',
      kind: 'video',
      version: 2,
      strategy: 'identity',
      actual_usd: 0.63,
    },
  ];

  it('reports the count, the spend and the consistency band, and filters the grid', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.startsWith('/api/characters/maya/usage')) return json({ items: usage });
      if (url.startsWith('/api/characters/maya')) return json({ item: usageItem, assets: [] });
      return json({});
    });
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(<CharacterDetail handle="maya" />));
    await settle();

    const usageTab = [...host.querySelectorAll('button')].find((button) =>
      button.textContent?.startsWith('Usage'),
    ) as HTMLButtonElement;
    await act(async () => usageTab.click());
    await settle();

    expect(host.querySelector('.character-usage-summary')?.textContent).toBe(
      '2 assets · $0.67 spent · avg consistency: high (opt-in check)',
    );
    expect(host.querySelector('.character-usage-open')?.getAttribute('href')).toBe('/library?q=@maya');
    expect(host.querySelectorAll('.character-usage-cell')).toHaveLength(2);

    // Filtering by version leaves one asset and re-totals the header.
    const version = host.querySelector('.character-usage-filters select') as HTMLSelectElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      setter?.call(version, '2');
      version.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();
    expect(host.querySelectorAll('.character-usage-cell')).toHaveLength(1);
    expect(host.querySelector('.character-usage-summary')?.textContent).toBe(
      '1 assets · $0.63 spent · avg consistency: high (opt-in check)',
    );
  });
});

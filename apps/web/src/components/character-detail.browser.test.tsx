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

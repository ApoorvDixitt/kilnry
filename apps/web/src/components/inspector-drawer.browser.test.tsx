// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { InspectorDrawer, hasGeneration } from './inspector-drawer';
import type { AssetDetail, MetadataPatch } from '../lib/composer-types';

let root: Root | undefined;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function detail(overrides: Partial<AssetDetail> = {}): AssetDetail {
  return {
    id: 'asset-1',
    path: 'inbox/hero.png',
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
    sha256: 'abc',
    bytes: 2048,
    model_id: 'fal-ai/flux',
    file_mtime: null,
    indexed_at: '2026-09-19T00:00:00.000Z',
    tags: ['hero'],
    label: 'green',
    rating: 3,
    user_notes: 'client pick',
    generation: null,
    lineage: { made_from: [], used_in: [] },
    sidecar_path: 'inbox/hero.png.kilnry.json',
    activity: [{ action: 'Saved', actor: 'user', at: '2026-09-19T00:00:00.000Z' }],
    ...overrides,
  };
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

async function render(props: Parameters<typeof InspectorDrawer>[0]): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<InspectorDrawer {...props} />));
  return host;
}

describe('hasGeneration', () => {
  it('is false for null or empty generation and true otherwise', () => {
    expect(hasGeneration({ generation: null })).toBe(false);
    expect(hasGeneration({ generation: {} })).toBe(false);
    expect(hasGeneration({ generation: { prompt: 'x' } })).toBe(true);
  });
});

describe('InspectorDrawer', () => {
  it('shows Info facts and the editable prompt when there is no recipe', async () => {
    const host = await render({ detail: detail(), onPatch: () => {} });
    expect(host.textContent).toContain('hero.png');
    expect(host.textContent).toContain('Prompt');
  });

  it('hides the editable prompt when the asset has a recipe', async () => {
    const host = await render({
      detail: detail({ generation: { prompt: 'a chai glass' } }),
      onPatch: () => {},
    });
    const infoPrompt = [...host.querySelectorAll('.inspector-field > span')].map((s) => s.textContent);
    expect(infoPrompt).not.toContain('Prompt');
  });

  it('removes a tag through the patch callback', async () => {
    const patches: MetadataPatch[] = [];
    const host = await render({ detail: detail(), onPatch: (p) => patches.push(p) });
    const tagButton = host.querySelector('.inspector-tag') as HTMLButtonElement;
    await act(async () => tagButton.click());
    expect(patches.at(-1)).toEqual({ tags: [] });
  });

  it('sets a rating through the patch callback', async () => {
    const patches: MetadataPatch[] = [];
    const host = await render({ detail: detail({ rating: 0 }), onPatch: (p) => patches.push(p) });
    const stars = host.querySelectorAll('.inspector-star');
    await act(async () => (stars[4] as HTMLButtonElement).click());
    expect(patches.at(-1)).toEqual({ rating: 5 });
  });

  it('switches to the Provenance tab and shows the model', async () => {
    const host = await render({
      detail: detail({ generation: { prompt: 'a chai glass' } }),
      onPatch: () => {},
    });
    const tab = [...host.querySelectorAll('[role="tab"]')].find(
      (b) => b.textContent === 'Provenance',
    ) as HTMLButtonElement;
    await act(async () => tab.click());
    expect(host.textContent).toContain('fal-ai/flux');
  });

  it('shows the activity timeline on the Activity tab', async () => {
    const host = await render({ detail: detail(), onPatch: () => {} });
    const tab = [...host.querySelectorAll('[role="tab"]')].find(
      (b) => b.textContent === 'Activity',
    ) as HTMLButtonElement;
    await act(async () => tab.click());
    expect(host.querySelector('.inspector-activity')?.textContent).toContain('Saved');
  });
});

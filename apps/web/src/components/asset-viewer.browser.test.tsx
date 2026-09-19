// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssetViewer } from './asset-viewer';
import type { AssetDetail } from '../lib/composer-types';

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
    tags: [],
    label: null,
    rating: 0,
    user_notes: '',
    generation: { prompt: 'a paper crane' },
    lineage: { made_from: [], used_in: [] },
    sidecar_path: 'inbox/hero.png.kilnry.json',
    activity: [],
    ...overrides,
  };
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

async function render(assetId: string): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<AssetViewer assetId={assetId} />);
    await Promise.resolve();
  });
  return host;
}

describe('AssetViewer', () => {
  it('renders the image and reveals the info overlay on toggle', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ asset: detail() }))),
    );
    const host = await render('asset-1');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const img = host.querySelector('.viewer-media') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/api/media/asset-1');
    const toggle = host.querySelector('.viewer-info-toggle') as HTMLButtonElement;
    await act(async () => toggle.click());
    expect(host.querySelector('.viewer-info')?.textContent).toContain('a paper crane');
  });

  it('shows the missing message when the asset is gone', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ error: {} }, { status: 404 }))),
    );
    const host = await render('gone');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.querySelector('.viewer-missing')?.textContent).toContain("isn't in your Library");
  });
});

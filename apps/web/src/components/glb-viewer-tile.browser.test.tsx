// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GlbViewerTile } from './glb-viewer-tile';

let root: Root | undefined;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

async function render(): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<GlbViewerTile assetId="asset-3d" />);
    await Promise.resolve();
  });
  return host;
}

function reducedMotion(reduce: boolean): void {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: reduce && query.includes('reduce'),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  );
}

describe('GlbViewerTile (F-CRE-15)', () => {
  it('without WebGL shows a static tile with "Open in your 3D app"', async () => {
    reducedMotion(false);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const host = await render();
    const viewer = host.querySelector('.glb-viewer')!;
    expect(viewer.getAttribute('data-viewer')).toBe('fallback');
    const open = host.querySelector('.glb-viewer-open') as HTMLAnchorElement;
    expect(open.textContent).toBe('Open in your 3D app');
    expect(open.getAttribute('href')).toBe('/api/media/asset-3d');
    expect(open.hasAttribute('download')).toBe(true);
  });

  it('starts with auto-rotate off under reduced motion and on otherwise', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    reducedMotion(true);
    let host = await render();
    expect(host.querySelector('.glb-viewer')!.getAttribute('data-auto-rotate')).toBe('false');
    await act(async () => root?.unmount());
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    reducedMotion(false);
    host = await render();
    expect(host.querySelector('.glb-viewer')!.getAttribute('data-auto-rotate')).toBe('true');
  });
});

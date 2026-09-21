// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CastBuilder } from './cast-builder';

let root: Root | undefined;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/characters/cast')) {
        return new Response(
          JSON.stringify({ params: { archetype: 'creator/host' }, generate: { count: 4 } }),
          { status: 200 },
        );
      }
      if (url.includes('/api/generate')) {
        return new Response(
          JSON.stringify({
            assets: [{ asset_id: 'a1' }, { asset_id: 'a2' }, { asset_id: 'a3' }, { asset_id: 'a4' }],
          }),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 200 });
    }),
  );
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

async function render(node: React.ReactNode): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
  return host;
}

function setValue(el: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('the cast builder (F-CHR-15)', () => {
  it('renders the trait selects and enables Generate by default', async () => {
    const host = await render(<CastBuilder onPick={() => undefined} />);
    expect(host.querySelectorAll('.cast-builder-form select').length).toBe(5);
    const button = host.querySelector('.btn.primary') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it('blocks Generate and warns when the region names a minor', async () => {
    const host = await render(<CastBuilder onPick={() => undefined} />);
    const region = host.querySelector('.cast-builder-region') as HTMLInputElement;
    await act(async () => setValue(region, 'a 15 year old'));
    expect(host.querySelector('.cast-builder-minor')).not.toBeNull();
    expect((host.querySelector('.btn.primary') as HTMLButtonElement).disabled).toBe(true);
  });

  it('generates four tiles and reports the picked anchor with cast params', async () => {
    const onPick = vi.fn();
    const host = await render(<CastBuilder onPick={onPick} />);
    await act(async () => (host.querySelector('.btn.primary') as HTMLButtonElement).click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const tiles = host.querySelectorAll('.cast-builder-tile');
    expect(tiles.length).toBe(4);
    await act(async () => (tiles[0] as HTMLButtonElement).click());
    expect(onPick).toHaveBeenCalledWith({ asset_id: 'a1', cast_params: { archetype: 'creator/host' } });
  });
});

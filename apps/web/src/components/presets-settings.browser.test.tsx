// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PresetsSettings } from './presets-settings';

let root: Root | undefined;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

const PRESETS = [
  {
    id: 'priya.product_shot.wet-slate',
    name: 'Wet slate hero',
    category: 'product_shot',
    description: 'A product on wet slate.',
    enabled: true,
    source: 'user',
  },
  {
    id: 'kilnry.poster.bold',
    name: 'Bold poster',
    category: 'poster',
    description: 'A bold poster.',
    enabled: true,
    user_disabled: true,
    source: 'bundled',
  },
];

async function render(): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<PresetsSettings />);
    await Promise.resolve();
  });
  return host;
}

describe('PresetsSettings (F-SET-06)', () => {
  it('lists every preset with its enabled state, including a disabled one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        // The tab asks for all presets, disabled included.
        expect(String(input)).toContain('all=1');
        return Promise.resolve(Response.json({ presets: PRESETS }));
      }),
    );
    const host = await render();
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.textContent).toContain('Wet slate hero');
    expect(host.textContent).toContain('Bold poster');
    const enabledToggle = host.querySelector<HTMLInputElement>(
      '[data-preset-id="priya.product_shot.wet-slate"] input',
    );
    const disabledToggle = host.querySelector<HTMLInputElement>(
      '[data-preset-id="kilnry.poster.bold"] input',
    );
    // The user-disabled preset shows its toggle off; the other shows on.
    expect(enabledToggle?.checked).toBe(true);
    expect(disabledToggle?.checked).toBe(false);
  });

  it('disables a preset through the preset route', async () => {
    const patches: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'PATCH') {
          patches.push({ url, body: JSON.parse(String(init.body)) });
          return Promise.resolve(Response.json({ ok: true }));
        }
        return Promise.resolve(Response.json({ presets: PRESETS }));
      }),
    );
    const host = await render();
    await act(async () => {
      await Promise.resolve();
    });
    // Toggle the enabled preset off.
    const toggle = host.querySelector<HTMLInputElement>(
      '[data-preset-id="priya.product_shot.wet-slate"] input',
    )!;
    await act(async () => {
      toggle.click();
      await Promise.resolve();
    });
    expect(patches).toHaveLength(1);
    expect(patches[0]!.url).toContain('/api/presets/priya.product_shot.wet-slate');
    expect(patches[0]!.body).toEqual({ enabled: false });
  });

  it('imports a preset from a URL through the import route', async () => {
    const posts: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'POST') {
          posts.push({ url, body: JSON.parse(String(init.body)) });
          return Promise.resolve(Response.json({ ok: true }));
        }
        return Promise.resolve(Response.json({ presets: PRESETS }));
      }),
    );
    const host = await render();
    await act(async () => {
      await Promise.resolve();
    });
    const input = host.querySelector<HTMLInputElement>('#preset-url')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(input, 'https://example.com/preset.json');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });
    const button = [...host.querySelectorAll('button')].find((element) => element.textContent === 'Import')!;
    await act(async () => {
      button.click();
      await Promise.resolve();
    });
    expect(posts).toHaveLength(1);
    expect(posts[0]!.url).toContain('/api/presets/import');
    expect(posts[0]!.body).toEqual({ url: 'https://example.com/preset.json' });
  });
});

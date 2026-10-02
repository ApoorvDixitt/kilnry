// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TransformsPanel } from './transforms-panel';

let root: Root | undefined;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

async function render(): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<TransformsPanel source="asset-1" onClose={() => {}} />);
    await Promise.resolve();
  });
  return host;
}

describe('TransformsPanel (F-CRE-11)', () => {
  it('runs the dubbing tab: shows the language field and prices it through the transform route', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/api/transform') && init?.method === 'POST') {
          return Promise.resolve(Response.json({ estimate: { estimate_usd: 0.33 }, estimate_usd: 0.33 }));
        }
        return Promise.resolve(Response.json({ asset: {} }));
      }),
    );
    const host = await render();
    // Switch to the Dubbing tab.
    const dubbingTab = [...host.querySelectorAll('.transforms-tabs button')].find(
      (button) => button.textContent === 'Dubbing',
    ) as HTMLButtonElement;
    await act(async () => {
      dubbingTab.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    // Dubbing renders a language field, not the not-available notice.
    expect(host.querySelector('.transforms-unavailable')).toBeNull();
    const language = host.querySelector('.transforms-language') as HTMLInputElement;
    expect(language).not.toBeNull();

    // With the language filled the panel prices the run and Run becomes enabled.
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      setter?.call(language, 'es');
      language.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    const run = host.querySelector('.transforms-run') as HTMLButtonElement;
    expect(run.disabled).toBe(false);
    expect(run.textContent).toContain('$0.33');
  });

  async function openThreeD(host: HTMLElement): Promise<void> {
    const tab = [...host.querySelectorAll('.transforms-tabs button')].find(
      (button) => button.textContent === 'Image → 3D',
    ) as HTMLButtonElement;
    await act(async () => {
      tab.click();
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
  }

  it('Image → 3D without a fal key says so and links to Connect fal (F-CRE-15)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          Response.json(
            { error: { code: 'NO_PROVIDER', message: 'No connected provider can run 3d.' } },
            { status: 424 },
          ),
        ),
      ),
    );
    const host = await render();
    await openThreeD(host);
    const notice = host.querySelector('.transforms-needs-key');
    expect(notice?.textContent).toContain('3D needs a fal key.');
    const link = notice?.querySelector('a');
    expect(link?.textContent).toBe('Connect fal');
    expect(link?.getAttribute('href')).toBe('/settings/providers');
    expect((host.querySelector('.transforms-run') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Image → 3D prices Trellis and Hunyuan3D on the strip and offers background removal (F-CRE-15)', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as { params?: { model3d?: string } };
        bodies.push(body);
        const premium = body.params?.model3d === 'hunyuan3d';
        return Promise.resolve(
          Response.json({
            estimate: { estimate_usd: premium ? 0.375 : 0.02, eta_s: premium ? 30 : 40 },
            estimate_usd: premium ? 0.375 : 0.02,
          }),
        );
      }),
    );
    const host = await render();
    await openThreeD(host);
    expect(host.querySelector('.transforms-cost')?.textContent).toBe('$0.02 · 1 model · ~40 s');
    expect(host.querySelector('.transforms-bg-first')?.textContent).toBe('Remove background first (+$0.018)');
    const select = host.querySelector('.transforms-model3d') as HTMLSelectElement;
    await act(async () => {
      select.value = 'hunyuan3d';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(host.querySelector('.transforms-cost')?.textContent).toBe('$0.375 · 1 model · ~30 s');
    expect((host.querySelector('.transforms-run') as HTMLButtonElement).textContent).toContain('$0.375');
    expect(bodies.at(-1)).toMatchObject({ op: 'image_to_3d', params: { model3d: 'hunyuan3d' } });
  });
});

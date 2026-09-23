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
});

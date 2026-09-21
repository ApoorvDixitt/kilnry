// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductFromUrl } from './product-from-url';

let root: Root | undefined;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const facts = {
  title: 'Hero Vitamin C Serum',
  price: '899 INR',
  images: ['https://cdn.test/bottle.jpg'],
  claims: ['Brightens in 14 days', 'Dermatologist tested'],
  source_url: 'https://example.in/p',
  fetched_at: '2026-09-21T00:00:00Z',
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ facts }), { status: 200 })),
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

describe('the product-from-URL element (F-ELM-04)', () => {
  it('keeps Fetch disabled until an https address is entered', async () => {
    const host = await render(<ProductFromUrl onFacts={() => undefined} />);
    const button = host.querySelector('.product-url-intake button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    const input = host.querySelector('.product-url-input') as HTMLInputElement;
    await act(async () => setValue(input, 'https://example.in/p'));
    expect((host.querySelector('.product-url-intake button') as HTMLButtonElement).disabled).toBe(false);
  });

  it('fetches, shows claims unticked, and reports only ticked claims', async () => {
    const onFacts = vi.fn();
    const host = await render(<ProductFromUrl onFacts={onFacts} />);
    const input = host.querySelector('.product-url-input') as HTMLInputElement;
    await act(async () => setValue(input, 'https://example.in/p'));
    await act(async () => (host.querySelector('.product-url-intake button') as HTMLButtonElement).click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    const claims = [...host.querySelectorAll('.product-url-claim input')] as HTMLInputElement[];
    expect(claims.length).toBe(2);
    // Every claim starts unticked (PRD-08 §A4).
    expect(claims.every((box) => !box.checked)).toBe(true);
    // First report after fetch carries no approved claims.
    expect(onFacts).toHaveBeenLastCalledWith({ facts, approved_claims: [] });
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set?.call(claims[0], true);
      claims[0]!.dispatchEvent(new Event('click', { bubbles: true }));
    });
    expect(onFacts).toHaveBeenLastCalledWith({ facts, approved_claims: ['Brightens in 14 days'] });
  });
});

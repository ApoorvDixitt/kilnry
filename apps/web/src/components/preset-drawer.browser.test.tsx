// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PresetDrawer } from './preset-drawer';
import type { DrawerPreset } from './preset-drawer-logic';

let root: Root | undefined;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const resolved = {
  prompt: 'The product in image 1, frozen in ice on black slate.',
  params: { aspect_ratio: '1:1', resolution: '2K' },
  medias: [{ role: 'product', ref: 'asset-1' }],
  count: 1,
  characters: [],
  missing: [] as string[],
};

const estimate = {
  estimate_usd: 0.04,
  breakdown: [{ label: 'image', usd: 0.04 }],
  unit_price: { unit: 'image', amount_usd: 0.04, fetched_at: new Date().toISOString() },
  adjustments: [],
  route: { provider: 'fal', model: 'fal-ai/bytedance/seedream/v4.5/edit', why: 'cheapest' },
  eta_s: 12,
};

let body: Record<string, unknown> = {};

beforeEach(() => {
  body = { resolved, estimate, model: { model: 'fal-ai/bytedance/seedream/v4.5/edit', reason: 'primary' } };
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
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
  // The drawer resolves and prices on a short debounce.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
  return host;
}

function preset(overrides: Partial<DrawerPreset> = {}): DrawerPreset {
  return {
    id: 'kilnry.product.ice-cube-splash',
    name: 'Ice Cube Splash',
    version: '1.0.0',
    description: 'Hero product frozen mid-splash.',
    category: 'product_shot',
    kind: 'image_edit',
    capability: 'image_edit',
    model: {
      id: 'fal-ai/bytedance/seedream/v4.5/edit',
      locked: false,
      alternates: ['bytedance-seed/seedream-4.5'],
    },
    params: { aspect_ratio: '1:1', resolution: '2K' },
    slots: [
      { name: 'product', type: 'media', label: 'Product', required: true, roles: ['product'] },
      {
        name: 'surface',
        type: 'enum',
        label: 'Surface',
        required: false,
        options: ['black slate', 'wet concrete'],
        default: 'black slate',
      },
      { name: 'extra', type: 'text', label: 'Anything else', required: false, default: '' },
    ],
    count: 1,
    indicative_cost_usd: 0.04,
    license: 'CC0-1.0',
    author: 'kilnry',
    ...overrides,
  };
}

describe('the preset use drawer (F-PRE-02)', () => {
  it('shows the name, category, author and licence chip', async () => {
    const host = await render(<PresetDrawer preset={preset()} onClose={() => undefined} />);
    expect(host.querySelector('.preset-drawer-name')?.textContent).toBe('Ice Cube Splash');
    expect(host.querySelector('.preset-drawer-category')?.textContent).toBe('product_shot');
    expect(host.querySelector('.preset-drawer-author')?.textContent).toBe('By kilnry');
    expect(host.querySelector('.preset-licence-chip')?.textContent).toBe('Licence CC0-1.0');
    expect(host.querySelector('.preset-drawer')?.getAttribute('role')).toBe('dialog');
  });

  it('draws one field per slot in order, with the right control for each type', async () => {
    const host = await render(<PresetDrawer preset={preset()} onClose={() => undefined} />);
    const fields = [...host.querySelectorAll('.preset-field')];
    expect(fields.length).toBe(3);
    expect(fields[0]?.querySelector('label')?.textContent).toContain('Product');
    expect(fields[0]?.querySelector('label')?.textContent).toContain('(required)');
    // The media slot uses the attachment tray, not a free-text field (F-PRE-02).
    expect(fields[0]?.querySelector('.preset-media-drop .attachment-tray')).not.toBeNull();
    expect(fields[1]?.querySelector('select')).not.toBeNull();
    expect(fields[2]?.querySelector('textarea')).not.toBeNull();
  });

  it('pre-fills a slot that has a default', async () => {
    const host = await render(<PresetDrawer preset={preset()} onClose={() => undefined} />);
    const select = host.querySelector('.preset-field select') as HTMLSelectElement;
    expect(select.value).toBe('black slate');
  });

  it('keeps Run disabled while a required slot is empty', async () => {
    const host = await render(<PresetDrawer preset={preset()} onClose={() => undefined} />);
    const run = host.querySelector('.preset-run-button') as HTMLButtonElement;
    expect(run.disabled).toBe(true);
  });

  it('fills a media slot by dropping a Library asset and shows the price', async () => {
    const host = await render(<PresetDrawer preset={preset()} onClose={() => undefined} />);
    const drop = host.querySelector('.preset-media-drop') as HTMLElement;
    await act(async () => {
      const transfer = { getData: (type: string) => (type === 'text/plain' ? 'asset-1' : '') };
      const dropEvent = new Event('drop', { bubbles: true });
      Object.defineProperty(dropEvent, 'dataTransfer', { value: transfer });
      drop.dispatchEvent(dropEvent);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    const run = host.querySelector('.preset-run-button') as HTMLButtonElement;
    expect(run.textContent).toBe('Run · $0.04');
    expect(run.disabled).toBe(false);
    // The chosen asset now sits in the tray as an attachment for the slot's role.
    expect(host.querySelector('.preset-media-drop .attachment-item')).not.toBeNull();
  });

  it('fills a character slot from the @ picker restricted to its kind', async () => {
    body = {
      resolved,
      estimate,
      model: { model: 'fal-ai/bytedance/seedream/v4.5/edit', reason: 'primary' },
    };
    const characterPreset = preset({
      slots: [{ name: 'hero', type: 'character', label: 'Hero', required: true, kinds: ['character'] }],
    });
    // The picker asks the mention endpoint for suggestions of the slot's kind.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/characters/mentions')) {
          expect(url).toContain('kinds=character');
          return new Response(
            JSON.stringify({
              items: [{ handle: 'maya', display_name: 'Maya', kind: 'character', version: 1 }],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
    const host = await render(<PresetDrawer preset={characterPreset} onClose={() => undefined} />);
    const input = host.querySelector('.preset-slot-picker input') as HTMLInputElement;
    expect(input.getAttribute('role')).toBe('combobox');
    await act(async () => input.focus());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const suggestion = host.querySelector('.preset-slot-suggestion') as HTMLButtonElement;
    expect(suggestion.textContent).toContain('@maya');
    await act(async () => suggestion.click());
    expect(host.querySelector('.preset-slot-chip-handle')?.textContent).toBe('@maya');
  });

  it('shows the price on the Run button once a required slot is filled', async () => {
    const host = await render(<PresetDrawer preset={preset()} onClose={() => undefined} />);
    const drop = host.querySelector('.preset-media-drop') as HTMLElement;
    await act(async () => {
      const transfer = { getData: (type: string) => (type === 'text/plain' ? 'asset-1' : '') };
      const dropEvent = new Event('drop', { bubbles: true });
      Object.defineProperty(dropEvent, 'dataTransfer', { value: transfer });
      drop.dispatchEvent(dropEvent);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    const run = host.querySelector('.preset-run-button') as HTMLButtonElement;
    expect(run.textContent).toBe('Run · $0.04');
    expect(run.disabled).toBe(false);
  });

  it('offers the model and its alternates when the preset does not lock one', async () => {
    const host = await render(<PresetDrawer preset={preset()} onClose={() => undefined} />);
    const select = host.querySelector('.preset-drawer-section select[aria-label="Change the model"]');
    expect([...(select?.querySelectorAll('option') ?? [])].map((option) => option.textContent)).toEqual([
      'fal-ai/bytedance/seedream/v4.5/edit',
      'bytedance-seed/seedream-4.5',
      'Auto',
    ]);
  });

  it('shows a plain chip instead when the model is locked', async () => {
    const host = await render(
      <PresetDrawer
        preset={preset({ model: { id: 'fal-ai/flux-2-pro', locked: true, alternates: [] } })}
        onClose={() => undefined}
      />,
    );
    expect(host.querySelector('.preset-model-chip')?.textContent).toBe('fal-ai/flux-2-pro');
    expect(host.querySelector('select[aria-label="Change the model"]')).toBeNull();
  });

  it('summarises the settings and reveals the resolved prompt under Advanced', async () => {
    const host = await render(<PresetDrawer preset={preset()} onClose={() => undefined} />);
    expect(host.querySelector('.preset-params-summary')?.textContent).toBe('1:1 · 2K · 1 output');
    expect(host.querySelector('.preset-prompt-preview')).toBeNull();
    const toggle = host.querySelector('.preset-advanced-toggle') as HTMLButtonElement;
    await act(async () => toggle.click());
    expect(host.querySelector('.preset-prompt-preview')?.textContent).toBe(resolved.prompt);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('offers Open in Create and a live Save copy', async () => {
    const host = await render(<PresetDrawer preset={preset()} onClose={() => undefined} />);
    const labels = [...host.querySelectorAll('.preset-secondary-button')].map((node) => node.textContent);
    expect(labels).toEqual(['Open in Create', 'Save copy…']);
    const saveCopy = host.querySelectorAll('.preset-secondary-button')[1] as HTMLButtonElement;
    expect(saveCopy.disabled).toBe(false);
    expect(saveCopy.getAttribute('title')).toBe('Save a copy of this preset');
  });

  it('closes when Close is pressed', async () => {
    const close = vi.fn();
    const host = await render(<PresetDrawer preset={preset()} onClose={close} />);
    const button = host.querySelector('.preset-drawer-close') as HTMLButtonElement;
    await act(async () => button.click());
    expect(close).toHaveBeenCalledOnce();
  });

  it('marks an empty required field once the form has been touched', async () => {
    const host = await render(<PresetDrawer preset={preset()} onClose={() => undefined} />);
    expect(host.querySelector('.preset-field.is-invalid')).toBeNull();
    const extra = host.querySelector('#preset-slot-extra') as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(extra, 'mint leaves');
      extra.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const invalid = host.querySelector('.preset-field.is-invalid');
    expect(invalid?.querySelector('label')?.textContent).toContain('Product');
    expect(invalid?.querySelector('.preset-field-error')?.textContent).toBe('Fill this in before running.');
  });

  it('says nothing about the model when the first hint is the one used', async () => {
    const host = await render(<PresetDrawer preset={preset()} onClose={() => undefined} />);
    expect(host.querySelector('.preset-model-note')).toBeNull();
  });

  it('says which alternate it fell back to when the first hint is out of reach', async () => {
    body = { resolved, estimate, model: { model: 'bytedance-seed/seedream-4.5', reason: 'alternate' } };
    const host = await render(<PresetDrawer preset={preset()} onClose={() => undefined} />);
    expect(host.querySelector('.preset-model-note')?.textContent).toBe(
      'Using bytedance-seed/seedream-4.5, the next model this preset suggests that one of your keys can reach.',
    );
    expect((host.querySelector('select[aria-label="Change the model"]') as HTMLSelectElement).value).toBe(
      'bytedance-seed/seedream-4.5',
    );
  });

  it('says the router will choose when no hint can be reached', async () => {
    body = { resolved, estimate, model: { model: 'auto', reason: 'auto' } };
    const host = await render(<PresetDrawer preset={preset()} onClose={() => undefined} />);
    expect(host.querySelector('.preset-model-note')?.textContent).toBe(
      'None of the models this preset suggests is reachable with your keys, so the router will pick one.',
    );
  });

  it('says when a Character anchor stands in for the first frame', async () => {
    body = { resolved, estimate, model: { model: 'minimax/hailuo-3', reason: 'primary' }, anchor: true };
    const host = await render(<PresetDrawer preset={preset()} onClose={() => undefined} />);
    expect(host.querySelector('.preset-anchor-note')?.textContent).toBe(
      'This preset has no still to start from, so the Character anchor becomes the first frame.',
    );
  });
});

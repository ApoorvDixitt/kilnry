// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChecklistWidget, checklistHidden, type ChecklistStatus } from './checklist-widget';

let root: Root | undefined;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function status(overrides: Partial<ChecklistStatus> = {}): ChecklistStatus {
  return {
    generate: false,
    organise: false,
    workflow: false,
    mcp: false,
    completed: 0,
    total: 4,
    ...overrides,
  };
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

async function render(): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<ChecklistWidget />);
    await Promise.resolve();
  });
  return host;
}

describe('checklistHidden', () => {
  it('hides when dismissed or when every item is complete', () => {
    expect(checklistHidden(status(), false)).toBe(false);
    expect(checklistHidden(status(), true)).toBe(true);
    expect(checklistHidden(status({ completed: 4 }), false)).toBe(true);
    expect(checklistHidden(null, false)).toBe(false);
  });
});

describe('ChecklistWidget', () => {
  it('shows progress and a done item with a strike-through', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ checklist: status({ generate: true, completed: 1 }) }))),
    );
    const host = await render();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.textContent).toContain('1 of 4');
    expect(host.querySelector('.checklist-item.is-done')?.textContent).toContain('Generate something');
  });

  it('hides after Hide is clicked', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ checklist: status({ completed: 1, generate: true }) }))),
    );
    const host = await render();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => (host.querySelector('.checklist-hide') as HTMLButtonElement).click());
    expect(host.querySelector('.getting-started')).toBeNull();
    expect(window.localStorage.getItem('kilnry-checklist-dismissed')).toBe('1');
  });
});

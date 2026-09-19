// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SelectionBar } from './selection-bar';

let root: Root | undefined;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

async function render(props: Parameters<typeof SelectionBar>[0]): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<SelectionBar {...props} />));
  return host;
}

const noop = { onDelete: () => {}, onRestore: () => {}, onClear: () => {} };

describe('SelectionBar', () => {
  it('renders nothing with no selection', async () => {
    const host = await render({ count: 0, inTrash: false, ...noop });
    expect(host.querySelector('.selection-bar')).toBeNull();
  });

  it('shows the count and a Delete action outside Trash', async () => {
    const onDelete = vi.fn();
    const host = await render({ count: 3, inTrash: false, ...noop, onDelete });
    expect(host.querySelector('.selection-count')?.textContent).toBe('3 selected');
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Delete'));
    await act(async () => (button as HTMLButtonElement).click());
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it('offers Restore instead of Delete inside Trash', async () => {
    const onRestore = vi.fn();
    const host = await render({ count: 2, inTrash: true, ...noop, onRestore });
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Restore'));
    expect(button).toBeDefined();
    await act(async () => (button as HTMLButtonElement).click());
    expect(onRestore).toHaveBeenCalledOnce();
  });
});

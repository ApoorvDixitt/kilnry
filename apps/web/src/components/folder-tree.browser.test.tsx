// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FolderTree, type FolderNode } from './folder-tree';

let root: Root | undefined;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const folders: FolderNode[] = [
  { name: 'inbox', path: 'inbox', pinned: 'inbox' },
  { name: 'Campaign_A', path: 'Campaign_A' },
  { name: 'Trash', path: 'Trash', pinned: 'trash' },
];

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

async function render(props: Parameters<typeof FolderTree>[0]): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<FolderTree {...props} />));
  return host;
}

describe('FolderTree', () => {
  it('lists folders and marks the selected one', async () => {
    const host = await render({ folders, selected: 'Campaign_A', onSelect: () => {} });
    const names = [...host.querySelectorAll('.folder-tree-name')].map((n) => n.textContent);
    expect(names).toEqual(['inbox', 'Campaign_A', 'Trash']);
    expect(host.querySelector('.folder-tree-item.is-selected')?.textContent).toContain('Campaign_A');
  });

  it('selects a folder through the callback', async () => {
    const picks: string[] = [];
    const host = await render({ folders, selected: 'inbox', onSelect: (p) => picks.push(p) });
    const button = [...host.querySelectorAll('.folder-tree-item')].find((b) =>
      b.textContent?.includes('Campaign_A'),
    ) as HTMLButtonElement;
    await act(async () => button.click());
    expect(picks).toEqual(['Campaign_A']);
  });

  it('renames a folder on double-click and Enter', async () => {
    const onRename = vi.fn();
    const host = await render({ folders, selected: 'inbox', onSelect: () => {}, onRename });
    const button = [...host.querySelectorAll('.folder-tree-item')].find((b) =>
      b.textContent?.includes('Campaign_A'),
    ) as HTMLButtonElement;
    await act(async () => button.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    const input = host.querySelector('.folder-tree-rename') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, 'Final');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(onRename).toHaveBeenCalledWith('Campaign_A', 'Final');
  });

  it('does not let a pinned folder be renamed', async () => {
    const onRename = vi.fn();
    const host = await render({ folders, selected: 'inbox', onSelect: () => {}, onRename });
    const inbox = [...host.querySelectorAll('.folder-tree-item')].find((b) =>
      b.textContent?.includes('inbox'),
    ) as HTMLButtonElement;
    await act(async () => inbox.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    expect(host.querySelector('.folder-tree-rename')).toBeNull();
  });

  it('creates a folder through the add control', async () => {
    const onCreate = vi.fn();
    const host = await render({ folders, selected: 'inbox', onSelect: () => {}, onCreate });
    await act(async () => (host.querySelector('.folder-tree-add') as HTMLButtonElement).click());
    const input = host.querySelector('.folder-tree-rename') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, 'Drafts');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(onCreate).toHaveBeenCalledWith('Drafts');
  });
});

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assetIdFromDrag,
  attachmentKey,
  attachmentLabel,
  ChatAttachmentTray,
  type ChatAttachment,
} from './chat-attachment-tray';

let root: Root | undefined;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

async function render(node: React.ReactNode): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
  return host;
}

// A drag payload the Library would hand over.
function dragData(values: Record<string, string>): { getData: (type: string) => string } {
  return { getData: (type: string) => values[type] ?? '' };
}

describe('assetIdFromDrag (F-CHT-05)', () => {
  it('reads the id out of the Library payload', () => {
    expect(
      assetIdFromDrag(dragData({ 'application/x-kilnry-asset': '{"asset_id":"01JIMAGE","path":"a.png"}' })),
    ).toBe('01JIMAGE');
  });

  it('accepts a bare id dropped as plain text', () => {
    expect(assetIdFromDrag(dragData({ 'text/plain': ' 01JIMAGE ' }))).toBe('01JIMAGE');
  });

  it('ignores a drop that carries no asset', () => {
    expect(assetIdFromDrag(dragData({ 'text/plain': 'some dragged sentence' }))).toBeUndefined();
    expect(assetIdFromDrag(dragData({}))).toBeUndefined();
  });
});

describe('attachment labels (F-CHT-05)', () => {
  it('keys and labels assets and characters distinctly', () => {
    const asset: ChatAttachment = { kind: 'asset', asset_id: '01J', name: 'chai.png' };
    const character: ChatAttachment = { kind: 'character', handle: 'maya' };
    expect(attachmentKey(asset)).toBe('asset:01J');
    expect(attachmentKey(character)).toBe('character:maya');
    expect(attachmentLabel(asset)).toBe('chai.png');
    expect(attachmentLabel(character)).toBe('@maya');
  });
});

describe('ChatAttachmentTray (F-CHT-05)', () => {
  it('invites a drag from the Library when empty', async () => {
    const host = await render(<ChatAttachmentTray attachments={[]} onAdd={() => {}} onRemove={() => {}} />);
    expect(host.querySelector('.chat-attach-hint')?.textContent).toBe(
      'Drag an asset from the Library, or paste an asset id.',
    );
  });

  it('lists what is attached and can remove one', async () => {
    const onRemove = vi.fn();
    const host = await render(
      <ChatAttachmentTray
        attachments={[
          { kind: 'asset', asset_id: '01J', name: 'chai.png' },
          { kind: 'character', handle: 'maya' },
        ]}
        onAdd={() => {}}
        onRemove={onRemove}
      />,
    );
    const names = [...host.querySelectorAll('.chat-attach-name')].map((node) => node.textContent);
    expect(names).toEqual(['chai.png', '@maya']);
    const remove = host.querySelector<HTMLButtonElement>('.chat-attach-item button');
    expect(remove?.getAttribute('aria-label')).toBe('Remove chai.png');
    await act(async () => remove?.click());
    expect(onRemove).toHaveBeenCalledWith('asset:01J');
  });

  it('says a character is sent by reference, not as a likeness', async () => {
    const host = await render(
      <ChatAttachmentTray
        attachments={[{ kind: 'character', handle: 'maya' }]}
        onAdd={() => {}}
        onRemove={() => {}}
      />,
    );
    expect(host.querySelector('.chat-attach-note')?.textContent).toBe(
      'The agent sees a character by reference and looks it up; it never receives a likeness directly.',
    );
  });

  it('adds an asset dropped from the Library', async () => {
    const onAdd = vi.fn();
    const host = await render(<ChatAttachmentTray attachments={[]} onAdd={onAdd} onRemove={() => {}} />);
    const tray = host.querySelector('.chat-attach-tray');
    const event = new Event('drop', { bubbles: true }) as Event & { dataTransfer: unknown };
    Object.defineProperty(event, 'dataTransfer', {
      value: { getData: (type: string) => (type === 'text/plain' ? '01JIMAGE' : '') },
    });
    await act(async () => {
      tray?.dispatchEvent(event);
    });
    expect(onAdd).toHaveBeenCalledWith({ kind: 'asset', asset_id: '01JIMAGE', name: '01JIMAGE' });
  });
});

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { AttachmentTray } from './attachment-tray';
import { isBlockedUrl, validateAttachmentRoles, type Attachment, type RoleLimit } from '../lib/attachments';

let root: Root | undefined;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function attachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: crypto.randomUUID(),
    name: 'serum.png',
    role: 'reference',
    kind: 'image',
    pinned: false,
    ...overrides,
  };
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

async function render(props: Parameters<typeof AttachmentTray>[0]): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<AttachmentTray {...props} />));
  return host;
}

describe('isBlockedUrl', () => {
  it('rejects private, loopback, link-local and non-http URLs', () => {
    for (const url of [
      'http://10.0.0.5/a.png',
      'http://172.16.4.4/a.png',
      'http://172.31.255.255/a.png',
      'http://192.168.1.10/a.png',
      'http://127.0.0.1/a.png',
      'http://169.254.169.254/latest/meta-data',
      'http://localhost:3000/a.png',
      'https://[::1]/a.png',
      'https://[fe80::1]/a.png',
      'https://[fc00::1]/a.png',
      'file:///etc/passwd',
      'not a url',
    ]) {
      expect(isBlockedUrl(url)).toBe(true);
    }
  });

  it('allows ordinary public URLs', () => {
    expect(isBlockedUrl('https://cdn.example.com/a.png')).toBe(false);
    expect(isBlockedUrl('http://8.8.8.8/a.png')).toBe(false);
    expect(isBlockedUrl('http://172.15.0.1/a.png')).toBe(false);
    expect(isBlockedUrl('http://172.32.0.1/a.png')).toBe(false);
  });
});

describe('validateAttachmentRoles', () => {
  const limits: RoleLimit[] = [
    { role: 'reference', max: 4 },
    { role: 'start_frame', max: 1 },
  ];

  it('accepts a set within the limits', () => {
    expect(validateAttachmentRoles([attachment(), attachment()], limits)).toBeNull();
  });

  it('rejects a role the model does not accept', () => {
    expect(validateAttachmentRoles([attachment({ role: 'audio' })], limits)).toMatch(/does not take/);
  });

  it('rejects too many of one role with a count-aware message', () => {
    const many = Array.from({ length: 5 }, () => attachment({ role: 'reference' }));
    expect(validateAttachmentRoles(many, limits)).toMatch(/up to 4/);
    const two = [attachment({ role: 'start_frame' }), attachment({ role: 'start_frame' })];
    expect(validateAttachmentRoles(two, limits)).toMatch(/Only one/);
  });

  it('enforces a minimum when set', () => {
    expect(validateAttachmentRoles([], [{ role: 'source', min: 1, max: 1 }])).toMatch(/at least 1/);
  });
});

describe('AttachmentTray', () => {
  const limits: RoleLimit[] = [
    { role: 'reference', max: 4 },
    { role: 'product', max: 1 },
    { role: 'start_frame', max: 1 },
  ];

  it('changes a role and toggles the pin through the callback', async () => {
    const item = attachment();
    let current: Attachment[] = [item];
    const host = await render({
      attachments: current,
      limits,
      onChange: (next) => {
        current = next;
      },
    });
    const select = host.querySelector('select') as HTMLSelectElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      setter?.call(select, 'product');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(current[0]?.role).toBe('product');

    current = [item];
    await act(async () => (host.querySelector('.attachment-pin') as HTMLButtonElement).click());
    expect(current[0]?.pinned).toBe(true);
  });

  it('rejects a private-range URL before importing and shows the exact copy', async () => {
    const imported: string[] = [];
    const host = await render({
      attachments: [],
      limits,
      onChange: () => {},
      onImportUrl: (url) => imported.push(url),
    });
    const input = host.querySelector('.attachment-url') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, 'http://169.254.169.254/latest');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(imported).toHaveLength(0);
    expect(host.querySelector('.attachment-error')?.textContent).toContain('private network');
  });

  it('surfaces a role-limit error when too many of one role are attached', async () => {
    const host = await render({
      attachments: [attachment({ role: 'product' }), attachment({ role: 'product' })],
      limits,
      onChange: () => {},
    });
    expect(host.querySelector('.attachment-error')?.textContent).toMatch(/Only one/);
  });
});

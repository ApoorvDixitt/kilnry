// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoiceBindPicker } from './voice-bind-picker';

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
    root!.render(<VoiceBindPicker handle="maya" />);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return host;
}

describe('VoiceBindPicker (F-CHR-08)', () => {
  it('lists voices and binds the picked provider-preset voice through the manage route', async () => {
    const posts: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/api/voices/manage') && init?.method === 'POST') {
          posts.push(JSON.parse(String(init.body)));
          return Promise.resolve(Response.json({ item: { handle: 'maya' } }));
        }
        if (url.includes('/api/voices')) {
          return Promise.resolve(
            Response.json({ voices: [{ provider: 'elevenlabs', voice_id: 'rachel', name: 'Rachel' }] }),
          );
        }
        return Promise.resolve(Response.json({}));
      }),
    );
    const host = await render();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    // The bind button is disabled until a voice is picked.
    const bindButton = host.querySelector('.character-voice-bind') as HTMLButtonElement;
    expect(bindButton.disabled).toBe(true);
    const select = host.querySelector('.character-voice-select') as HTMLSelectElement;
    expect([...select.options].some((option) => option.value === 'elevenlabs:rachel')).toBe(true);

    // Pick the preset and bind it.
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
      setter?.call(select, 'elevenlabs:rachel');
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(bindButton.disabled).toBe(false);
    await act(async () => {
      bindButton.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      action: 'bind',
      handle: 'maya',
      preset_provider: 'elevenlabs',
      preset_voice_id: 'rachel',
      preset_name: 'Rachel',
    });
  });
});

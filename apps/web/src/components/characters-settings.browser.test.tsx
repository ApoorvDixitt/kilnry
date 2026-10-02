// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CharactersSettings } from './characters-settings';
import { ConsistencyBadge, consistencyBadgeView } from './consistency-badge';

let root: Root | undefined;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  await act(async () => {
    root!.render(node);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return host;
}

const off = {
  enabled: false,
  installed: false,
  download_bytes: 391_192_661,
  progress: { phase: 'idle', received: 0, total: 0 },
};

describe('Settings › Characters consistency check (F-CHR-12)', () => {
  it('is off by default and offers "Enable the consistency check" with the download size', async () => {
    const posts: unknown[] = [];
    let current: Record<string, unknown> = off;
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST') {
          posts.push(JSON.parse(String(init.body)));
          current = { ...off, progress: { phase: 'downloading', received: 120_000_000, total: 391_192_661 } };
        }
        return Promise.resolve(Response.json(current));
      }),
    );
    const host = await render(<CharactersSettings />);
    await vi.waitFor(() => expect(host.querySelector('.consistency-enable-button')).not.toBeNull());
    const enable = host.querySelector('.consistency-enable-button') as HTMLButtonElement;
    expect(enable.textContent).toBe('Enable the consistency check');
    expect(host.querySelector('.consistency-size')?.textContent).toContain('391 MB');
    expect(host.textContent).toContain('Face check only. Stylised and non-human characters are not scored.');
    await act(async () => {
      enable.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(posts).toEqual([{ enabled: true }]);
    await vi.waitFor(() =>
      expect(host.querySelector('.consistency-progress')?.textContent).toBe(
        'Downloading face models · 120 MB of 391 MB',
      ),
    );
  });

  it('shows the on state with its switch once enabled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          Response.json({
            ...off,
            enabled: true,
            installed: true,
            progress: { phase: 'installed', received: 0, total: 0 },
          }),
        ),
      ),
    );
    const host = await render(<CharactersSettings />);
    await vi.waitFor(() =>
      expect(host.querySelector('.consistency-ready')?.textContent).toBe(
        'On · models verified · scoring runs on this machine',
      ),
    );
    expect(host.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true');
    expect(host.querySelector('.consistency-enable-button')).toBeNull();
  });
});

describe('ConsistencyBadge (F-CHR-12)', () => {
  it('names the level, never a percentage, and gives a video its min and mean', async () => {
    const video = { badge: 'medium', min: 0.38, mean: 0.52, frames: 10, character: '@maya' };
    expect(consistencyBadgeView(video)?.tooltip).toBe('Looks like @maya · min 0.38 · mean 0.52');
    expect(
      consistencyBadgeView({ badge: 'high', min: 0.61, mean: 0.61, frames: 1, character: '@maya' })?.tooltip,
    ).toBe('Looks like @maya · score 0.61');
    expect(consistencyBadgeView(null)).toBeNull();
    const host = await render(<ConsistencyBadge score={video} />);
    const badge = host.querySelector('.consistency-badge')!;
    expect(badge.textContent).toBe('Medium');
    expect(badge.getAttribute('data-level')).toBe('medium');
    expect(badge.textContent).not.toContain('%');
  });
});

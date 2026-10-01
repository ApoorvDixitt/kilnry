// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderSettings } from './provider-settings';

let root: Root | undefined;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

async function render(component: React.ReactNode): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(component);
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
  return host;
}

describe('M2 provider UI', () => {
  it('renders provider status with text and keeps saved keys masked', async () => {
    const host = await render(
      <ProviderSettings
        initialProviders={[
          {
            id: 'fal',
            display_name: 'fal',
            connected: true,
            status: 'ok',
            key_prefix: 'abcde••••wxyz',
            model_count: 61,
            spend_month_usd: 0,
          },
          {
            id: 'openrouter',
            display_name: 'OpenRouter',
            connected: false,
            status: 'not_connected',
            model_count: 31,
            spend_month_usd: 0,
          },
        ]}
      />,
    );
    expect(host.textContent).toContain('Connected');
    expect(host.textContent).toContain('abcde••••wxyz');
    expect(host.querySelector('input[type="password"]')).not.toBeNull();
  });

  it('shows the locked recovery banner and surfaces the checksum words on a wrong kit (S-22)', async () => {
    const calls: Array<{ url: string; body?: unknown }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.body) calls.push({ url, body: JSON.parse(String(init.body)) });
        if (url.includes('/api/security/key-store')) {
          const body = init?.body ? (JSON.parse(String(init.body)) as { recovery_kit?: string }) : undefined;
          if (body?.recovery_kit?.includes('wrong')) {
            return Promise.resolve(
              Response.json(
                {
                  error: {
                    code: 'INVALID_INPUT',
                    message: 'That recovery kit does not match this installation.',
                    details: { checksum_words: 'kiln slate amber river' },
                  },
                },
                { status: 400 },
              ),
            );
          }
          if (body?.recovery_kit) {
            return Promise.resolve(Response.json({ ok: true, status: { locked: false } }));
          }
          return Promise.resolve(
            Response.json({ status: { locked: true, checksum_words: 'kiln slate amber river' } }),
          );
        }
        if (url.includes('/api/providers/ollama/detect'))
          return Promise.resolve(Response.json({ detected: false, base_url: '', models: [] }));
        if (url.includes('/api/providers')) return Promise.resolve(Response.json({ providers: [] }));
        return Promise.resolve(Response.json({}));
      }),
    );
    const host = await render(<ProviderSettings />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    const banner = host.querySelector('.provider-locked');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain(
      "Your provider keys are encrypted but the master key is missing from this machine's keychain.",
    );
    expect(banner?.textContent).toContain('Enter recovery kit');

    const textarea = banner!.querySelector('textarea')!;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(textarea, `kilnry1${'wrong'.repeat(4)}`);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const restoreButton = Array.from(banner!.querySelectorAll('button')).find(
      (button) => button.textContent === 'Restore keys',
    )!;
    await act(async () => restoreButton.click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(host.querySelector('.provider-locked .form-error')?.textContent).toBe(
      "That kit doesn't match. Check the checksum words: kiln slate amber river.",
    );

    // The correct kit clears the locked banner.
    await act(async () => {
      setter.call(textarea, `kilnry1${'0'.repeat(40)}`);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => restoreButton.click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(host.querySelector('.provider-locked')).toBeNull();
  });
});

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
});

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloneVoiceDrawer } from './clone-voice';

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
  await act(async () => root!.render(node));
  return host;
}

function setValue(el: HTMLInputElement, value: string): void {
  const proto = el.type === 'checkbox' ? undefined : HTMLInputElement.prototype;
  if (proto) {
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

describe('the clone-voice drawer (F-VOI-02)', () => {
  it('shows the provider consent line, its summarised label and a policy link, and Kilnry’s own line', async () => {
    const host = await render(<CloneVoiceDrawer handle="maya" onClose={() => undefined} />);
    const provider = host.querySelector('.clone-voice-consent-provider');
    expect(provider?.textContent).toContain('Only clone voices you own or have permission to use.');
    expect(host.querySelector('.clone-voice-consent-summarised')?.textContent).toContain(
      '(provider policy, summarised)',
    );
    const link = host.querySelector('.clone-voice-consent-source') as HTMLAnchorElement | null;
    expect(link?.textContent).toContain('Read the MiniMax policy');
    expect(link?.getAttribute('href')).toContain('minimax.io');
    expect(host.querySelector('.clone-voice-consent-check')?.textContent).toContain(
      "I confirm this is my voice or I have the speaker's explicit permission",
    );
  });

  it('keeps Clone disabled until the sample is long enough and consent is ticked', async () => {
    const host = await render(<CloneVoiceDrawer handle="maya" onClose={() => undefined} />);
    const button = host.querySelector('.clone-voice-actions button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    const inputs = [...host.querySelectorAll('input')] as HTMLInputElement[];
    const name = inputs.find((i) => i.type === 'text')!;
    const sample = inputs.find((i) => i.type === 'url')!;
    const seconds = inputs.find((i) => i.type === 'number')!;
    const consent = inputs.find((i) => i.type === 'checkbox')!;
    await act(async () => {
      setValue(name, 'Riya');
      setValue(sample, 'https://media.test/s.mp3');
      setValue(seconds, '30');
    });
    // Still disabled without consent.
    expect((host.querySelector('.clone-voice-actions button') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set?.call(consent, true);
      consent.dispatchEvent(new Event('click', { bubbles: true }));
    });
    expect((host.querySelector('.clone-voice-actions button') as HTMLButtonElement).disabled).toBe(false);
    expect((host.querySelector('.clone-voice-actions button') as HTMLButtonElement).textContent).toBe(
      'Clone · $1.50',
    );
  });

  it('warns when the sample is under ten seconds', async () => {
    const host = await render(<CloneVoiceDrawer handle="maya" onClose={() => undefined} />);
    const inputs = [...host.querySelectorAll('input')] as HTMLInputElement[];
    const sample = inputs.find((i) => i.type === 'url')!;
    const seconds = inputs.find((i) => i.type === 'number')!;
    await act(async () => {
      setValue(sample, 'https://media.test/s.mp3');
      setValue(seconds, '6');
    });
    expect(host.querySelector('.clone-voice-warn')?.textContent).toContain('at least 10 seconds');
  });
});

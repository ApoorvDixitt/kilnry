// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// UX-12: the form showed a bare "This is a real person" toggle, and the consent
// radios appeared only once it was on. A user who left the toggle off to skip
// the extra fields created a real person as fictional, and PRD-07 §7's consent
// gate then never fired on training. One question now sets both facts, and each
// answer shows its own §7 clause.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({
  __esModule: true,
  default: {},
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/characters',
}));

import { CreateCharacter } from './create-character';

vi.hoisted(() => {
  const scope = globalThis as unknown as { process?: { env: Record<string, string> } };
  scope.process ??= { env: {} };
});

let root: Root | undefined;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

async function render(): Promise<HTMLElement> {
  vi.stubGlobal(
    'fetch',
    async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
  );
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<CreateCharacter />));
  return host;
}

function answers(host: HTMLElement): HTMLInputElement[] {
  return [...host.querySelectorAll<HTMLInputElement>('.create-character-who input[name="who"]')];
}

describe('who is this (F-CHR-06, UX-12)', () => {
  it('asks once, with the four answers and a clause for the chosen one', async () => {
    const host = await render();
    const options = answers(host);
    expect(options.map((input) => input.value)).toEqual(['fictional', 'self', 'written', 'other']);
    // A fictional character is the default and needs no consent.
    expect(options[0]?.checked).toBe(true);
    expect(host.querySelector('.create-character-consent-note')?.textContent).toContain('No consent needed');

    // "Me" is a real person with consent recorded.
    await act(async () => options[1]!.click());
    expect(host.querySelector('.create-character-consent-note')?.textContent).toContain(
      'Only upload photos of yourself',
    );

    // "Someone else" is a real person without consent, and says what that means.
    await act(async () => options[3]!.click());
    expect(host.querySelector('.create-character-consent-note')?.textContent).toContain(
      'Training and voice cloning stay disabled',
    );
  });

  it('has no separate real-person toggle left to disagree with it', async () => {
    const host = await render();
    expect(host.querySelector('.create-character-toggle')).toBeNull();
  });
});

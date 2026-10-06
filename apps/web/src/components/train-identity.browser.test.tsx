// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { TrainerCards } from './train-identity';

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

function buttons(host: HTMLElement): HTMLButtonElement[] {
  return [...host.querySelectorAll('.character-trainer-card button')] as HTMLButtonElement[];
}

describe('the Train control (F-CHR-07)', () => {
  it('disables every trainer for a Character that reads as a minor, with the exact tooltip (F-07)', async () => {
    const picked: string[] = [];
    const host = await render(
      <TrainerCards
        training={null}
        consentBlocks={false}
        minorSuspected
        onPick={(choice) => picked.push(choice.trainer)}
      />,
    );
    expect(buttons(host)).toHaveLength(3);
    for (const button of buttons(host)) {
      expect(button.disabled).toBe(true);
      expect(button.title).toBe('Kilnry does not train or clone minors.');
    }
    expect(host.querySelector('.character-minor-refusal')?.textContent).toBe(
      'Kilnry does not train or clone minors.',
    );
    await act(async () => buttons(host)[0]!.click());
    expect(picked).toEqual([]);
  });

  it('offers each trainer at its price when nothing blocks it', async () => {
    const picked: Array<{ trainer: string; cost: number }> = [];
    const host = await render(
      <TrainerCards
        training={null}
        consentBlocks={false}
        minorSuspected={false}
        onPick={(c) => picked.push(c)}
      />,
    );
    expect(buttons(host).map((b) => [b.disabled, b.textContent])).toEqual([
      [false, 'Train · $2.00'],
      [false, 'Train · $1.46'],
      [false, 'Train · $2.50'],
    ]);
    expect(host.querySelector('.character-minor-refusal')).toBeNull();
    await act(async () => buttons(host)[1]!.click());
    expect(picked).toEqual([{ trainer: 'replicate', cost: 1.46 }]);
  });

  it('keeps the consent tooltip for a real person without consent', async () => {
    const host = await render(
      <TrainerCards training={null} consentBlocks minorSuspected={false} onPick={() => undefined} />,
    );
    expect(
      buttons(host).every((b) => b.disabled && b.title === 'Set consent for this real person first.'),
    ).toBe(true);
  });
});

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModeratedTile, moderatedTitle } from './moderated-tile';

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

describe('moderatedTitle', () => {
  it('says not charged when there was no compute charge', () => {
    expect(moderatedTitle({ provider: 'fal' })).toBe(
      "Blocked by the provider's content filter. Not charged.",
    );
    expect(moderatedTitle({ provider: 'fal', computeUsd: 0 })).toContain('Not charged');
  });

  it('names the compute charge when the provider billed for it', () => {
    expect(moderatedTitle({ provider: 'fal', computeUsd: 0.02 })).toBe(
      "Blocked by the provider's content filter. fal may charge for compute used: $0.02.",
    );
  });
});

describe('ModeratedTile', () => {
  it('shows the provider reason and the three recovery actions', async () => {
    const host = await render(
      <ModeratedTile info={{ provider: 'fal', reason: 'flagged by a content checker' }} />,
    );
    expect(host.querySelector('.moderated-reason')?.textContent).toBe('flagged by a content checker');
    const labels = [...host.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toEqual(['Edit prompt', 'Try another model', 'Dismiss']);
  });

  it('invokes Dismiss', async () => {
    const onDismiss = vi.fn();
    const host = await render(<ModeratedTile info={{ provider: 'fal' }} onDismiss={onDismiss} />);
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Dismiss');
    await act(async () => (button as HTMLButtonElement).click());
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('omits the reason line when none is given', async () => {
    const host = await render(<ModeratedTile info={{ provider: 'fal' }} />);
    expect(host.querySelector('.moderated-reason')).toBeNull();
  });
});

// UX-08 (T47 fix-forward): the compute-charge headline interpolated the raw
// provider id ("openrouter still billed …").
describe('the moderated headline spells the provider', () => {
  it('names OpenRouter, not openrouter', () => {
    expect(moderatedTitle({ provider: 'openrouter', computeUsd: 0.02 })).toContain('OpenRouter');
    expect(moderatedTitle({ provider: 'openrouter', computeUsd: 0.02 })).not.toContain('openrouter');
  });
});

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResultTileActions, rerunNeedsConfirm } from './result-tile-actions';

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

describe('rerunNeedsConfirm', () => {
  it('asks for confirmation only when the price moves more than ten per cent', () => {
    expect(rerunNeedsConfirm(1.0, 1.05)).toBe(false);
    expect(rerunNeedsConfirm(1.0, 1.2)).toBe(true);
    expect(rerunNeedsConfirm(0, 0)).toBe(false);
    expect(rerunNeedsConfirm(0, 0.02)).toBe(true);
  });
});

describe('ResultTileActions', () => {
  const noop = {};

  it('shows the completed action row and hides Reveal when the platform cannot reveal', async () => {
    const host = await render(
      <ResultTileActions status="completed" capabilities={{ reveal: false }} handlers={noop} />,
    );
    const labels = [...host.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toContain('Use prompt');
    expect(labels).toContain('Use as reference');
    expect(labels).toContain('Re-run');
    expect(labels).toContain('Copy path');
    expect(labels).toContain('Delete');
    expect(labels).not.toContain('Reveal in Finder');
  });

  it('shows Reveal only when the platform reports it', async () => {
    const host = await render(
      <ResultTileActions status="completed" capabilities={{ reveal: true }} handlers={noop} />,
    );
    expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Reveal in Finder')).toBe(true);
  });

  it('shows the failed action row instead of the completed one', async () => {
    const host = await render(
      <ResultTileActions status="failed" capabilities={{ reveal: true }} handlers={noop} />,
    );
    const labels = [...host.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toEqual(['Retry', 'Edit prompt', 'Copy error']);
  });

  it('invokes the handler for a clicked action', async () => {
    const onUsePrompt = vi.fn();
    const host = await render(
      <ResultTileActions status="completed" capabilities={{ reveal: false }} handlers={{ onUsePrompt }} />,
    );
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Use prompt');
    await act(async () => (button as HTMLButtonElement).click());
    expect(onUsePrompt).toHaveBeenCalledOnce();
  });
});

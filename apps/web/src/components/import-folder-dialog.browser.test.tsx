// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// F-125: the toolbar's "Import folder" re-indexed the folder already shown. The
// dialog posts a path on this computer, the Library folder and copy or move.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImportFolderDialog, importSummary } from './import-folder-dialog';

let root: Root | undefined;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function setValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('Import folder… (F-ONB-07, F-125)', () => {
  it('posts the source path, the Library folder and the mode, and reports where the files went', async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({
        report: { imported: 3, duplicates: 1, destination: 'Client_A/Renders', mode: 'move' },
      });
    });
    const done = vi.fn();
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () =>
      root!.render(<ImportFolderDialog defaultInto="Client_A" onDone={done} onClose={() => {}} />),
    );
    const [source, into] = [...host.querySelectorAll<HTMLInputElement>('input:not([type="radio"])')];
    expect(into!.value).toBe('Client_A');
    await act(async () => setValue(source!, '/Users/you/Renders'));
    const move = host.querySelectorAll<HTMLInputElement>('input[type="radio"]')[1]!;
    await act(async () => move.click());
    await act(async () => host.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
    await vi.waitFor(() => expect(done).toHaveBeenCalled());
    expect(bodies).toEqual([{ source: '/Users/you/Renders', into: 'Client_A', mode: 'move' }]);
    expect(done).toHaveBeenCalledWith(
      'Imported 3 files into Client_A/Renders. 1 files were already in your Library and were skipped.',
    );
  });

  it('summarises an in-place import without a duplicates line', () => {
    expect(importSummary({ imported: 2, destination: 'Legacy', mode: 'in_place' })).toBe(
      'Imported 2 files into Legacy.',
    );
  });
});

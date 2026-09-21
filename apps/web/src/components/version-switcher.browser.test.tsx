// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VersionSwitcher } from './version-switcher';
import type { VersionRowView } from './character-detail-logic';

let root: Root | undefined;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const versions: VersionRowView[] = [
  { version: 2, frozen: false, current: true, jobs: 0 },
  { version: 1, frozen: true, current: false, jobs: 31 },
];

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

describe('the character version switcher (F-CHR-10)', () => {
  it('lists every version with its markers and job count, current selected', async () => {
    const host = await render(<VersionSwitcher versions={versions} current={2} onSelect={() => undefined} />);
    const select = host.querySelector('.character-version-select') as HTMLSelectElement;
    const options = [...select.querySelectorAll('option')].map((option) => option.textContent);
    expect(options).toEqual(['v2 · current · 0 jobs', 'v1 · frozen · 31 jobs']);
    expect(select.value).toBe('2');
    // The current version (v2) is not frozen, so no fork note is shown.
    expect(host.querySelector('.character-version-note')).toBeNull();
  });

  it('explains why a frozen current version forks when edited', async () => {
    const host = await render(
      <VersionSwitcher
        versions={[{ version: 1, frozen: true, current: true, jobs: 31 }]}
        current={1}
        onSelect={() => undefined}
      />,
    );
    expect(host.querySelector('.character-version-note')?.textContent).toContain('frozen');
  });

  it('reports the chosen version to set as current', async () => {
    const onSelect = vi.fn();
    const host = await render(<VersionSwitcher versions={versions} current={2} onSelect={onSelect} />);
    const select = host.querySelector('.character-version-select') as HTMLSelectElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      setter?.call(select, '1');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onSelect).toHaveBeenCalledWith(1);
  });
});

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, test } from 'vitest';
import { BrandMark } from './brand-mark';

afterEach(() => {
  document.body.replaceChildren();
});

test('renders the two-shape Kilnry mark as decorative content', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(BrandMark, { size: 28 })));
  const mark = host.querySelector('.brand-mark');
  expect(mark?.getAttribute('aria-hidden')).toBe('true');
  expect(mark?.querySelector('.brand-mark-arch')).not.toBeNull();
  expect(mark?.querySelector('.brand-mark-spark')).not.toBeNull();
  root.unmount();
});

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { afterEach, describe, expect, it } from 'vitest';
import { isNetworkOnline, markNetworkOffline, markNetworkOnline } from './network-state.js';

afterEach(() => markNetworkOnline());

describe('network state (F40)', () => {
  it('defaults to online', () => {
    expect(isNetworkOnline()).toBe(true);
  });

  it('flips offline on a connection failure and back online on a success', () => {
    markNetworkOffline();
    expect(isNetworkOnline()).toBe(false);
    markNetworkOnline();
    expect(isNetworkOnline()).toBe(true);
  });
});

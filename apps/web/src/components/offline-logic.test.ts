// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import {
  WAITING_FOR_NETWORK,
  isLocalNetworkError,
  isNonTerminal,
  resumableCount,
  resumedToast,
} from './offline-logic';

describe('offline-logic (F-JOB-05)', () => {
  it('treats queued, running and waiting jobs as non-terminal', () => {
    expect(isNonTerminal('queued')).toBe(true);
    expect(isNonTerminal('running')).toBe(true);
    expect(isNonTerminal('waiting')).toBe(true);
    expect(isNonTerminal('completed')).toBe(false);
    expect(isNonTerminal('failed')).toBe(false);
    expect(isNonTerminal('cancelled')).toBe(false);
    expect(isNonTerminal('moderated')).toBe(false);
  });

  it('counts only the jobs that would resume', () => {
    expect(
      resumableCount([
        { status: 'queued' },
        { status: 'running' },
        { status: 'completed' },
        { status: 'failed' },
      ]),
    ).toBe(2);
  });

  it('writes the reconnect toast with the right plural', () => {
    expect(resumedToast(1)).toBe('Back online. Resumed 1 job.');
    expect(resumedToast(3)).toBe('Back online. Resumed 3 jobs.');
  });

  it('exposes the waiting-for-network label', () => {
    expect(WAITING_FOR_NETWORK).toBe('Waiting for network');
  });

  // F-117: a generation made while the machine is offline showed the browser's
  // own "Failed to fetch" on the tile. PRD-15:153 words it as waiting for the
  // network, and the server keeps the job queued.
  it('reads a failed local request as offline, not as a provider failure', () => {
    expect(isLocalNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isLocalNetworkError(new TypeError('NetworkError when attempting to fetch resource.'))).toBe(true);
    expect(isLocalNetworkError(new Error('Kilnry could not price that request.'))).toBe(false);
  });
});

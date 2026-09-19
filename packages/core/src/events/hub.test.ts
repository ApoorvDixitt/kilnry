// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { EventHub } from './hub.js';

describe('SSE event hub', () => {
  it('sequences live events and replays only events after Last-Event-ID', () => {
    const hub = new EventHub();
    const received: number[] = [];
    const unsubscribe = hub.subscribe((event) => received.push(event.id));
    hub.emit({
      type: 'runtime.online',
      online: true,
      ts: '2026-09-19T00:00:00.000Z',
    });
    hub.emit({
      type: 'job.updated',
      job_id: '01J00000000000000000000000',
      status: 'queued',
      estimate_usd: 0.01,
      ts: '2026-09-19T00:00:01.000Z',
    });
    unsubscribe();
    expect(received).toEqual([1, 2]);
    expect(hub.since(1)).toMatchObject([{ id: 2, event: { type: 'job.updated' } }]);
  });
});

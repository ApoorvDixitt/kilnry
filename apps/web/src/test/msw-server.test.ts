// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The acceptance suite's provider fixtures must answer in each provider's
// documented shape (D-57), or a scenario passes on a path the real provider
// never takes. These drive the real adapters against the fixtures.

import { beforeAll, describe, expect, it } from 'vitest';
import { adapters } from '@kilnry/providers';
import { startTestMsw } from './msw-server';

beforeAll(() => {
  startTestMsw();
});

const context = {
  key: 'test-key',
  fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
  signal: new AbortController().signal,
};

// F-99: the Higgsfield status fixture returned `results[]`, a key the adapter
// never reads, so a completed job in the suite failed as "no downloadable
// output". The documented completed payload is `images[{url}]`, `video{url}`
// or `audio{url}` (https://docs.higgsfield.ai/docs/concepts/requests.md, as
// recorded in 04-reference/providers-models-pricing-2026-09.md:475).
describe('Higgsfield status fixture (F-PRV-01, F-99)', () => {
  it('completes a Soul 2 job with one image the adapter can download', async () => {
    const result = await adapters.higgsfield!.poll(
      { request_id: 'hf_req_1', status_url: 'https://api.higgsfield.ai/requests/hf_req_1/status' } as never,
      context as never,
    );
    expect(result.state).toBe('completed');
    expect((result as { result: { outputs: Array<{ kind: string; url: string }> } }).result.outputs).toEqual([
      expect.objectContaining({ kind: 'image', url: expect.stringMatching(/^https:\/\//) }),
    ]);
  });
});

// F-93 / F-94: the fal status fixture answered COMPLETED on the first poll with
// no logs, so the queued → running progression and the step label the adapter
// takes from fal's logs never ran in the suite.
describe('fal queue status fixture (F-JOB-01, F-93, F-94)', () => {
  it('goes IN_QUEUE, then IN_PROGRESS with a log line, then COMPLETED', async () => {
    const handle = {
      request_id: 'kilnry-progress-1',
      status_url: 'https://queue.fal.run/fal-ai/flux/requests/kilnry-progress-1/status',
      response_url: 'https://queue.fal.run/fal-ai/flux/requests/kilnry-progress-1',
    };
    const queued = await adapters.fal!.poll(handle as never, context as never);
    expect(queued).toMatchObject({ state: 'queued', position: 1 });
    const running = await adapters.fal!.poll(handle as never, context as never);
    expect(running).toMatchObject({
      state: 'running',
      step_label: 'Rendering at fal',
      logs: ['Rendering at fal'],
    });
    const done = await adapters.fal!.poll(handle as never, context as never);
    expect(done.state).toBe('completed');
  });
});

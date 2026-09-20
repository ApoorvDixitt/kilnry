// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { CanonicalRequestSchema, type AdapterContext, type CanonicalRequest } from '@kilnry/core';
import { replicateAdapter } from './index.js';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const BASE = 'https://api.replicate.com/v1';
const KEY = ['r8_', 'A'.repeat(38)].join('');
const MODEL = 'ostris/flux-dev-lora-trainer/abc123version';

function context(): AdapterContext {
  return { key: KEY, fetch, signal: new AbortController().signal, log: () => undefined };
}

function trainingRequest(): CanonicalRequest {
  return CanonicalRequestSchema.parse({
    kind: 'image',
    capability: 'train_lora',
    prompt: 'train an identity for @maya',
    params: { extra: { model: MODEL, training_input: { steps: 1000 } } },
    medias: [],
    injections: [],
    count: 1,
    target_folder: 'inbox',
    source: 'ui',
  });
}

describe('Replicate adapter (training subset, F-PRV-01)', () => {
  it('testKey succeeds against the account endpoint', async () => {
    server.use(
      http.get(`${BASE}/account`, ({ request }) => {
        expect(request.headers.get('authorization')).toBe(`Bearer ${KEY}`);
        return HttpResponse.json({ username: 'apoorv' });
      }),
    );
    const tested = await replicateAdapter.testKey(KEY, { fetch });
    expect(tested.ok).toBe(true);
  });

  it('submits a training and polls until it succeeds with a new version', async () => {
    server.use(
      http.post(`${BASE}/models/ostris/flux-dev-lora-trainer/versions/abc123version/trainings`, () =>
        HttpResponse.json({
          id: 't1',
          status: 'starting',
          urls: { get: `${BASE}/trainings/t1`, cancel: `${BASE}/trainings/t1/cancel` },
        }),
      ),
      http.get(`${BASE}/trainings/t1`, () =>
        HttpResponse.json({ id: 't1', status: 'succeeded', output: { version: 'apoorv/maya-lora:v1' } }),
      ),
    );
    const handle = await replicateAdapter.submit(trainingRequest(), context());
    expect(handle.provider_request_id).toBe('t1');
    const poll = await replicateAdapter.poll(handle, context());
    expect(poll.state).toBe('completed');
    if (poll.state === 'completed') {
      const json = poll.result.outputs[0]?.json as { version?: string };
      expect(json.version).toBe('apoorv/maya-lora:v1');
    }
  });

  it('refuses image generation with a training-only message', async () => {
    const request = CanonicalRequestSchema.parse({
      kind: 'image',
      capability: 'text2image',
      prompt: 'a kiln',
      params: { extra: { model: 'black-forest-labs/flux-2-pro' } },
      medias: [],
      injections: [],
      count: 1,
      target_folder: 'inbox',
      source: 'ui',
    });
    await expect(replicateAdapter.submit(request, context())).rejects.toMatchObject({ code: 'NO_PROVIDER' });
  });

  it('lists no generation models', async () => {
    expect(await replicateAdapter.listModels(KEY, { fetch })).toEqual([]);
  });
});

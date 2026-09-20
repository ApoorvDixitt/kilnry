// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { CanonicalRequestSchema, type AdapterContext, type CanonicalRequest } from '@kilnry/core';
import { detectOllama, ollamaAdapter } from './index.js';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const BASE = 'http://127.0.0.1:11434';

function tagsHandler(): ReturnType<typeof http.get> {
  return http.get(`${BASE}/api/tags`, () =>
    HttpResponse.json({
      models: [
        { name: 'qwen3:8b', size: 4_900_000_000, details: { parameter_size: '8B' } },
        { name: 'gemma3:12b', size: 6_700_000_000, details: { parameter_size: '12B' } },
        { name: 'llama2:7b', size: 3_800_000_000, details: { parameter_size: '7B' } },
      ],
    }),
  );
}

function showHandler(): ReturnType<typeof http.post> {
  return http.post(`${BASE}/api/show`, async ({ request }) => {
    const body = (await request.json()) as { model?: string };
    if (body.model === 'qwen3:8b')
      return HttpResponse.json({ capabilities: ['tools'], model_info: { 'qwen3.context_length': 32_768 } });
    if (body.model === 'gemma3:12b')
      return HttpResponse.json({
        capabilities: ['tools', 'vision'],
        model_info: { 'gemma3.context_length': 8_192 },
      });
    return HttpResponse.json({ capabilities: [], model_info: {} });
  });
}

function context(): AdapterContext {
  return { key: '', fetch, signal: new AbortController().signal, log: () => undefined };
}

describe('Ollama detection (F-PRV-08)', () => {
  it('reports detected:false and no models when the loopback probe is refused', async () => {
    server.use(http.get(`${BASE}/api/tags`, () => HttpResponse.error()));
    const detection = await detectOllama();
    expect(detection.detected).toBe(false);
    expect(detection.models).toEqual([]);
    expect(detection.error).toContain('ollama.com');
  });

  it('lists installed models with tool and vision capabilities from /api/tags and /api/show', async () => {
    server.use(tagsHandler(), showHandler());
    const detection = await detectOllama();
    expect(detection.detected).toBe(true);
    expect(detection.models.map((model) => model.name)).toEqual(['qwen3:8b', 'gemma3:12b', 'llama2:7b']);
    const qwen = detection.models.find((model) => model.name === 'qwen3:8b');
    expect(qwen?.tools).toBe(true);
    expect(qwen?.vision).toBe(false);
    expect(qwen?.context_length).toBe(32_768);
    const gemma = detection.models.find((model) => model.name === 'gemma3:12b');
    expect(gemma?.tools).toBe(true);
    expect(gemma?.vision).toBe(true);
    const llama = detection.models.find((model) => model.name === 'llama2:7b');
    expect(llama?.tools).toBe(false);
  });

  it('testKey succeeds with the model count when Ollama answers', async () => {
    server.use(tagsHandler(), showHandler());
    const tested = await ollamaAdapter.testKey('', { fetch });
    expect(tested.ok).toBe(true);
    if (tested.ok) expect(tested.model_count).toBe(3);
  });

  it('testKey returns NO_PROVIDER when Ollama is not running', async () => {
    server.use(http.get(`${BASE}/api/tags`, () => HttpResponse.error()));
    const tested = await ollamaAdapter.testKey('', { fetch });
    expect(tested.ok).toBe(false);
    if (!tested.ok) expect(tested.error.code).toBe('NO_PROVIDER');
  });

  it('listModels maps detected models to free, local manifests with vlm when vision-capable', async () => {
    server.use(tagsHandler(), showHandler());
    const manifests = await ollamaAdapter.listModels('', { fetch });
    expect(manifests).toHaveLength(3);
    const gemma = manifests.find((manifest) => manifest.model_id === 'gemma3:12b');
    expect(gemma?.capabilities).toEqual(['llm', 'vlm']);
    expect(gemma?.price_rule).toEqual({ kind: 'free', unit: 'run' });
    expect(gemma?.retention_days).toBeNull();
    const qwen = manifests.find((manifest) => manifest.model_id === 'qwen3:8b');
    expect(qwen?.capabilities).toEqual(['llm']);
    expect(qwen?.tags).toContain('tools');
  });

  it('rejects media generation with NO_PROVIDER', async () => {
    const request: CanonicalRequest = CanonicalRequestSchema.parse({
      kind: 'image',
      capability: 'text2image',
      prompt: 'a kiln',
      params: {},
      medias: [],
      injections: [],
      count: 1,
      target_folder: 'inbox',
      source: 'ui',
    });
    await expect(ollamaAdapter.submit(request, context())).rejects.toMatchObject({ code: 'NO_PROVIDER' });
  });
});

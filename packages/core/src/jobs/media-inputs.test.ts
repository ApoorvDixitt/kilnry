// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assets, closeDatabaseState, createDatabase, type DatabaseState } from '@kilnry/db';
import { CanonicalRequestSchema, type CanonicalRequest } from '../types.js';
import type { AdapterContext, ProviderAdapter } from '../providers/adapter.js';
import { resolveMediaInputs } from './media-inputs.js';

const disposers: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
});

async function harness(): Promise<{ state: DatabaseState; library: string }> {
  const root = mkdtempSync(join(tmpdir(), 'kilnry-media-inputs-'));
  const dataDir = join(root, 'data');
  const library = join(root, 'library');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  mkdirSync(join(library, 'inbox'), { recursive: true });
  const state = createDatabase(dataDir, { memory: true });
  await state.ready;
  disposers.push(async () => {
    await closeDatabaseState(state);
    rmSync(root, { recursive: true, force: true });
  });
  return { state, library };
}

async function seedAsset(
  state: DatabaseState,
  library: string,
  options: { id: string; bytes: Uint8Array; name?: string },
): Promise<void> {
  const name = options.name ?? 'input.png';
  writeFileSync(join(library, 'inbox', name), options.bytes);
  await state.db.insert(assets).values({
    id: options.id,
    path: join('inbox', name),
    folderPath: 'inbox',
    kind: 'image',
    mime: 'image/png',
    bytes: options.bytes.byteLength,
    sha256: 'f'.repeat(64),
    source: 'generated',
    createdAt: new Date('2026-09-22T00:00:00.000Z'),
  });
}

function request(assetId: string): CanonicalRequest {
  return CanonicalRequestSchema.parse({
    kind: 'image_edit',
    capability: 'image_edit',
    prompt: 'brighter',
    params: {},
    medias: [{ role: 'product', asset_id: assetId }],
    injections: [],
    count: 1,
    target_folder: 'inbox',
    source: 'preset',
  });
}

function adapter(overrides: Partial<ProviderAdapter> = {}): ProviderAdapter {
  return {
    id: 'fal',
    display_name: 'fal',
    base_url: 'https://queue.fal.run',
    key_detection: null,
    concurrency: { default: 2, max_known: null },
    retention_days: 7,
    training_on_inputs: false,
    supports_authoritative_estimate: false,
    idempotency: 'none',
    testKey: async () => ({ ok: true as const, latency_ms: 1 }),
    listModels: async () => [],
    submit: async () => {
      throw new Error('not used');
    },
    poll: async () => {
      throw new Error('not used');
    },
    cancel: async () => ({ ok: true }),
    download: async () => [],
    normalizeError: (error) => error as never,
    ...overrides,
  } as ProviderAdapter;
}

function context(): AdapterContext {
  return { key: 'k', fetch, signal: new AbortController().signal, log: () => undefined };
}

describe('media inputs', () => {
  it('uploads a Library file when the provider has storage of its own', async () => {
    const { state, library } = await harness();
    await seedAsset(state, library, { id: 'asset-1', bytes: new Uint8Array([1, 2, 3, 4]) });
    const uploads: Array<{ mime: string; length: number }> = [];
    const resolved = await resolveMediaInputs(request('asset-1'), {
      state,
      libraryRoot: library,
      adapter: adapter({
        uploadFile: async (file) => {
          uploads.push({ mime: file.mime, length: file.bytes.byteLength });
          return { url: 'https://v3.fal.media/files/test/one.png' };
        },
      }),
      context: context(),
    });
    expect(resolved.medias[0]?.url).toBe('https://v3.fal.media/files/test/one.png');
    expect(uploads).toEqual([{ mime: 'image/png', length: 4 }]);
  });

  it('inlines a small file when the provider has no storage', async () => {
    const { state, library } = await harness();
    await seedAsset(state, library, { id: 'asset-2', bytes: new Uint8Array([9, 9, 9]) });
    const resolved = await resolveMediaInputs(request('asset-2'), {
      state,
      libraryRoot: library,
      adapter: adapter(),
      context: context(),
    });
    expect(resolved.medias[0]?.url).toBe(
      `data:image/png;base64,${Buffer.from([9, 9, 9]).toString('base64')}`,
    );
  });

  it('refuses a large file when there is nowhere to upload it', async () => {
    const { state, library } = await harness();
    await seedAsset(state, library, { id: 'asset-3', bytes: new Uint8Array(1_200_000) });
    await expect(
      resolveMediaInputs(request('asset-3'), {
        state,
        libraryRoot: library,
        adapter: adapter(),
        context: context(),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('leaves a public address alone and costs nothing when there is no media', async () => {
    const { state, library } = await harness();
    const withUrl = CanonicalRequestSchema.parse({
      ...request('asset-4'),
      medias: [{ role: 'product', url: 'https://example.test/photo.png' }],
    });
    const resolved = await resolveMediaInputs(withUrl, {
      state,
      libraryRoot: library,
      adapter: adapter(),
      context: context(),
    });
    expect(resolved.medias[0]?.url).toBe('https://example.test/photo.png');
    const none = CanonicalRequestSchema.parse({ ...request('asset-5'), medias: [] });
    expect(
      await resolveMediaInputs(none, {
        state,
        libraryRoot: library,
        adapter: adapter(),
        context: context(),
      }),
    ).toBe(none);
  });
});

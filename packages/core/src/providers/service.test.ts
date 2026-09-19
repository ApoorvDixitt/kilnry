// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDatabaseState, createDatabase } from '@kilnry/db';
import { KilnryError } from '../errors.js';
import type { ProviderAdapter } from './adapter.js';
import { refreshProviderPrices } from './service.js';
import { loadRegistry, seedRegistry } from '../registry/store.js';
import { ProviderKeyStore } from '../security/key-store.js';

const disposers: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose();
});

describe('provider price refresh', () => {
  it('persists the provider response as the new model rule, snapshot, and cache file', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kilnry-price-refresh-'));
    const state = createDatabase(dataDir, { memory: true });
    disposers.push(async () => {
      await closeDatabaseState(state);
      rmSync(dataDir, { recursive: true, force: true });
    });
    await state.ready;
    await seedRegistry(state);
    const keyStore = new ProviderKeyStore({
      dataDir,
      database: state,
      environment: { KILNRY_MASTER_KEY: randomBytes(32).toString('hex') },
    });
    await keyStore.initialize();
    await keyStore.save('fal', 'fixture-price-key');
    const adapter: ProviderAdapter = {
      id: 'fal',
      display_name: 'fal fixture',
      base_url: 'https://fixture.invalid',
      key_detection: null,
      concurrency: { default: 1, max_known: 1 },
      retention_days: 7,
      training_on_inputs: false,
      supports_authoritative_estimate: false,
      idempotency: 'none',
      testKey: () => Promise.resolve({ ok: true, latency_ms: 1 }),
      listModels: () => Promise.resolve([]),
      refreshPrices: () =>
        Promise.resolve([
          {
            model_id: 'fal-ai/flux-2/klein/4b',
            price_rule: {
              kind: 'per_megapixel',
              per_mp_usd: 0.009,
              count_inputs: false,
              round: 'ceil_each',
            },
            source_url: 'https://api.fal.ai/v1/models/pricing',
          },
        ]),
      submit: () => Promise.reject(new Error('not used')),
      poll: () => Promise.reject(new Error('not used')),
      cancel: () => Promise.resolve({ ok: false }),
      download: () => Promise.resolve([]),
      normalizeError: (error) =>
        error instanceof KilnryError
          ? error
          : new KilnryError('PROVIDER_ERROR', 'Fixture failed.', { cause: error }),
    };
    const result = await refreshProviderPrices({
      state,
      keyStore,
      adapters: { fal: adapter },
      provider: 'fal',
      dataDir,
    });
    expect(result.models).toBe(1);
    const registry = await loadRegistry(state);
    const model = registry.models.find((candidate) => candidate.model_id === 'fal-ai/flux-2/klein/4b');
    expect(model?.price_rule).toMatchObject({ kind: 'per_megapixel', per_mp_usd: 0.009 });
    expect(registry.snapshots.get('fal:fal-ai/flux-2/klein/4b')).toMatchObject({
      rule: { kind: 'per_megapixel', per_mp_usd: 0.009 },
      source: 'fal_pricing_api',
    });
    const cached = JSON.parse(readFileSync(join(dataDir, 'cache', 'pricing', 'fal.json'), 'utf8')) as {
      models?: Array<{ price_rule?: { per_mp_usd?: number } }>;
    };
    expect(cached.models?.[0]?.price_rule?.per_mp_usd).toBe(0.009);
  });
});

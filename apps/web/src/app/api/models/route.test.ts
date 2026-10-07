// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// F-109: PRD-05:111 — "a row without a price in the registry is not rendered
// and is logged." The picker dropped such a row and nothing recorded it.

import { describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('../../../server/http', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../server/http')>();
  return { ...original, requireSession: async () => ({ user: { id: 'owner' }, session: { id: 'session' } }) };
});
vi.mock('../../../server/runtime', () => ({ runtimeServices: async () => ({ database: {} }) }));
vi.mock('../../../server/log', () => ({ log: { warn: harness.warn, info: () => {}, error: () => {} } }));
vi.mock('@kilnry/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@kilnry/core')>();
  const priced = { provider: 'fal', model_id: 'fal-ai/flux', capabilities: ['text2image'] };
  const unpriced = { provider: 'fal', model_id: 'fal-ai/no-price', capabilities: ['text2image'] };
  return {
    ...original,
    loadRegistry: async () => ({
      models: [priced, unpriced],
      snapshots: new Map([
        [
          'fal:fal-ai/flux',
          {
            rule: { kind: 'flat_per_unit', unit: 'image', amount: 0.01 },
            fetched_at: '2026-10-05T00:00:00.000Z',
          },
        ],
      ]),
    }),
    providerRouteStates: async () => ({ fal: { connected: true } }),
  };
});

import { GET } from './route';

describe('GET /api/models (F-CRE-02, F-109)', () => {
  it('logs a model without a price once, however often the list is read', async () => {
    const first = (await (await GET()).json()) as { models: Array<{ model_id: string; price?: unknown }> };
    await GET();
    expect(first.models.find((model) => model.model_id === 'fal-ai/no-price')?.price).toBeUndefined();
    expect(harness.warn).toHaveBeenCalledTimes(1);
    expect(harness.warn).toHaveBeenCalledWith({ model: 'fal:fal-ai/no-price' }, 'model_without_price');
  });
});

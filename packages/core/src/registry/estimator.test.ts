// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { afterEach, describe, expect, it } from 'vitest';
import { closeDatabaseState, createDatabase, budgets, jobs, spendLedger } from '@kilnry/db';
import { ulid } from '../ids.js';
import { reserveBudget } from '../budget/enforcer.js';
import { CanonicalRequestSchema, type CanonicalRequest } from '../types.js';
import { estimate, withAuthoritativeEstimate } from './estimator.js';
import type { ModelManifest, PriceSnapshot } from './manifest.js';
import { seedModel, seedSnapshot } from './seed/index.js';

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose();
});

function request(
  input: Partial<CanonicalRequest> & Pick<CanonicalRequest, 'kind' | 'capability'>,
): CanonicalRequest {
  return CanonicalRequestSchema.parse({
    prompt: 'golden estimate',
    params: {},
    medias: [],
    injections: [],
    count: 1,
    target_folder: 'inbox',
    source: 'ui',
    ...input,
  });
}

function model(provider: string, id: string): ModelManifest {
  const found = seedModel(provider, id);
  if (!found) throw new Error(`Missing golden model ${provider}:${id}`);
  return found;
}

function freshSnapshot(value: ModelManifest): PriceSnapshot {
  return { ...seedSnapshot(value), fetched_at: '2026-09-19T00:00:00.000Z' };
}

interface Golden {
  id: string;
  model: ModelManifest;
  request: CanonicalRequest;
  expected: number;
  references?: { images?: Array<{ width: number; height: number }>; video_s?: number; audio_s?: number };
  text_chars?: number;
  steps?: number;
  token_usage?: { input: number; output: number };
  adjustment?: string;
}

const refs = (count: number, width = 1024, height = 1024): Array<{ width: number; height: number }> =>
  Array.from({ length: count }, () => ({ width, height }));

const goldens: Golden[] = [
  {
    id: 'G-01',
    model: model('fal', 'fal-ai/kling-video/v3/standard/image-to-video'),
    request: request({
      kind: 'video',
      capability: 'image2video',
      params: { resolution: '720p', duration_s: 5, audio: false },
    }),
    expected: 0.42,
  },
  {
    id: 'G-02',
    model: model('fal', 'fal-ai/kling-video/v3/pro/image-to-video'),
    request: request({
      kind: 'video',
      capability: 'image2video',
      params: { resolution: '1080p', duration_s: 5, audio: true },
    }),
    expected: 0.84,
  },
  {
    id: 'G-03',
    model: model('fal', 'fal-ai/kling-video/v3/pro/image-to-video'),
    request: request({
      kind: 'video',
      capability: 'image2video',
      params: { resolution: '1080p', duration_s: 10 },
      injections: [{ handle: 'voice', version: 1, strategy: 'voice_id', inputs: [] }],
    }),
    expected: 1.96,
  },
  {
    id: 'G-04',
    model: model('google', 'veo-3.1-generate-preview'),
    request: request({
      kind: 'video',
      capability: 'text2video',
      params: { resolution: '1080p', duration_s: 5, audio: true },
    }),
    expected: 2.4,
    adjustment: 'duration snapped 5→6',
  },
  {
    id: 'G-05',
    model: model('google', 'veo-3.1-generate-preview'),
    request: request({
      kind: 'video',
      capability: 'text2video',
      params: { resolution: '4k', duration_s: 8, audio: false },
    }),
    expected: 3.2,
  },
  {
    id: 'G-06',
    model: model('fal', 'fal-ai/bytedance/seedream/v4.5/text-to-image'),
    request: request({ kind: 'image', capability: 'text2image', count: 4, params: { resolution: '1K' } }),
    expected: 0.16,
  },
  {
    id: 'G-07',
    model: model('fal', 'fal-ai/nano-banana-2'),
    request: request({ kind: 'image', capability: 'text2image', params: { resolution: '2K' } }),
    expected: 0.12,
  },
  {
    id: 'G-08',
    model: model('fal', 'fal-ai/nano-banana-2'),
    request: request({
      kind: 'image',
      capability: 'text2image',
      params: { resolution: '4K', extra: { web_search: true } },
    }),
    expected: 0.175,
  },
  {
    id: 'G-09',
    model: model('fal', 'fal-ai/nano-banana-pro'),
    request: request({ kind: 'image', capability: 'text2image', params: { resolution: '4K' } }),
    expected: 0.3,
  },
  {
    id: 'G-10',
    model: model('fal', 'fal-ai/flux-2-pro'),
    request: request({ kind: 'image', capability: 'text2image', params: { width: 1000, height: 1000 } }),
    expected: 0.03,
  },
  {
    id: 'G-11',
    model: model('fal', 'fal-ai/flux-2-pro'),
    request: request({ kind: 'image', capability: 'text2image', params: { width: 1024, height: 1024 } }),
    references: { images: refs(1) },
    expected: 0.075,
  },
  {
    id: 'G-12',
    model: model('openai', 'gpt-image-2'),
    request: request({
      kind: 'image',
      capability: 'text2image',
      params: { width: 1024, height: 1024, quality: 'standard' },
    }),
    text_chars: 0,
    expected: 0.053,
  },
  {
    id: 'G-13',
    model: model('openai', 'gpt-image-2'),
    request: request({
      kind: 'image',
      capability: 'image_edit',
      params: { width: 1536, height: 1024, quality: 'premium' },
    }),
    references: { images: refs(1) },
    text_chars: 0,
    expected: 0.1894,
  },
  {
    id: 'G-14',
    model: model('google', 'gemini-3.1-flash-image'),
    request: request({ kind: 'image', capability: 'text2image', params: { resolution: '1K' } }),
    expected: 0.0672,
  },
  {
    id: 'G-15',
    model: model('google', 'gemini-3-pro-image'),
    request: request({ kind: 'image', capability: 'image_edit', params: { resolution: '4K' } }),
    references: { images: refs(2) },
    expected: 0.2422,
  },
  {
    id: 'G-16',
    model: model('openrouter', 'bytedance/seedance-2.5'),
    request: request({
      kind: 'video',
      capability: 'text2video',
      params: { width: 864, height: 480, resolution: '480p', duration_s: 5 },
    }),
    expected: 0.52,
  },
  {
    id: 'G-17',
    model: model('fal', 'bytedance/seedance-2.0/image-to-video'),
    request: request({
      kind: 'video',
      capability: 'image2video',
      params: { width: 1280, height: 720, resolution: '720p', duration_s: 5 },
    }),
    expected: 1.517,
  },
  {
    id: 'G-18',
    model: model('minimax', 'MiniMax-H3'),
    request: request({
      kind: 'video',
      capability: 'reference2video',
      params: { resolution: '768P', duration_s: 6 },
    }),
    references: { images: refs(7) },
    expected: 0.56,
  },
  {
    id: 'G-19',
    model: model('fal', 'minimax/h3-max/image-to-video'),
    request: request({
      kind: 'video',
      capability: 'image2video',
      params: { resolution: '1080p', duration_s: 10 },
    }),
    expected: 0.8,
  },
  {
    id: 'G-20',
    model: model('elevenlabs', 'eleven_v3'),
    request: request({ kind: 'audio', capability: 'tts' }),
    text_chars: 2500,
    expected: 0.25,
  },
  {
    id: 'G-21',
    model: model('minimax', 'speech-2.8-turbo'),
    request: request({ kind: 'audio', capability: 'tts' }),
    text_chars: 800,
    expected: 0.048,
  },
  {
    id: 'G-22',
    model: model('elevenlabs', 'scribe_v2'),
    request: request({ kind: 'audio', capability: 'stt' }),
    references: { audio_s: 750 },
    expected: 0.0458,
  },
  {
    id: 'G-23',
    model: model('fal', 'fal-ai/kling-video/lipsync/audio-to-video'),
    request: request({
      kind: 'video_edit',
      capability: 'lipsync',
      params: { resolution: '1080p', duration_s: 12 },
    }),
    expected: 0.21,
    adjustment: 'billed in 5 s steps',
  },
  {
    id: 'G-24',
    model: model('fal', 'fal-ai/topaz/upscale/video'),
    request: request({
      kind: 'video_edit',
      capability: 'upscale_video',
      params: { resolution: '1080p', duration_s: 10, extra: { fps: 60 } },
    }),
    expected: 0.4,
  },
  {
    id: 'G-25',
    model: model('fal', 'fal-ai/flux-lora-fast-training'),
    request: request({ kind: 'image', capability: 'train_lora' }),
    steps: 1000,
    expected: 2,
  },
  {
    id: 'G-26',
    model: model('fal', 'fal-ai/flux-2-trainer/edit'),
    request: request({ kind: 'image', capability: 'train_lora' }),
    references: { images: refs(2) },
    steps: 500,
    expected: 9.632,
  },
  {
    id: 'G-27',
    model: model('higgsfield', 'kling-video/v3.0/std/image-to-video'),
    request: request({
      kind: 'video',
      capability: 'image2video',
      params: { resolution: '720p', duration_s: 5 },
    }),
    expected: 0.42,
    adjustment: 'formula fallback',
  },
  {
    id: 'G-28',
    model: model('openrouter', 'anthropic/claude-sonnet-5'),
    request: request({ kind: 'image', capability: 'llm' }),
    token_usage: { input: 12_000, output: 800 },
    expected: 0.032,
  },
];

describe('TRD-19 estimator goldens', () => {
  for (const golden of goldens) {
    it(`${golden.id} estimates the canonical amount and marks a 31-day snapshot stale`, () => {
      const input = {
        model: golden.model,
        snapshot: freshSnapshot(golden.model),
        request: golden.request,
        ...(golden.references ? { references: golden.references } : {}),
        ...(golden.text_chars === undefined ? {} : { text_chars: golden.text_chars }),
        ...(golden.steps === undefined ? {} : { steps: golden.steps }),
        ...(golden.token_usage ? { token_usage: golden.token_usage } : {}),
        now: new Date('2026-09-19T12:00:00.000Z'),
      };
      const value = estimate(input);
      expect(value.estimate_usd).toBe(golden.expected);
      expect(value.breakdown.reduce((sum, row) => sum + row.usd, 0)).toBeCloseTo(value.estimate_usd, 6);
      if (golden.adjustment) expect(value.adjustments.join(' ')).toContain(golden.adjustment);

      const stale = estimate({
        ...input,
        snapshot: { ...input.snapshot, fetched_at: '2026-08-18T00:00:00.000Z' },
      });
      expect(stale.estimate_usd).toBe(golden.expected);
      expect(stale.adjustments).toContain('stale_price');
    });
  }

  it('G-27 records the authoritative provider estimate separately', () => {
    const golden = goldens.find((entry) => entry.id === 'G-27')!;
    const formula = estimate({
      model: golden.model,
      snapshot: freshSnapshot(golden.model),
      request: golden.request,
    });
    expect(withAuthoritativeEstimate(formula, 0.094)).toMatchObject({
      estimate_usd: 0.42,
      authoritative_usd: 0.094,
      source: 'provider',
    });
  });

  it('G-29 applies the configured stale-price threshold', () => {
    const golden = goldens[0]!;
    const value = estimate({
      model: golden.model,
      snapshot: { ...freshSnapshot(golden.model), fetched_at: '2026-08-18T00:00:00.000Z' },
      request: golden.request,
      now: new Date('2026-09-19T00:00:00.000Z'),
      price_max_age_days: 30,
    });
    expect(value.adjustments).toContain('stale_price');
  });

  it('G-30 counts terminal ledger spend and open reservations before submit', async () => {
    const state = createDatabase(`memory://${ulid()}`, { memory: true });
    disposers.push(() => closeDatabaseState(state));
    await state.ready;
    const now = new Date();
    await state.db.insert(budgets).values({ scope: 'daily', capUsd: '5.000000', behavior: 'block' });
    await state.db.insert(spendLedger).values({ id: ulid(), actualUsd: '4.700000', occurredAt: now });
    await state.db.insert(jobs).values({
      id: ulid(),
      kind: 'image',
      status: 'queued',
      source: 'ui',
      request: {},
      estimateUsd: '0.200000',
      targetFolder: 'inbox',
    });
    await expect(
      reserveBudget(state, { estimate_usd: 0.42, provider: 'fal', folder: 'inbox', now }),
    ).rejects.toMatchObject({
      code: 'BUDGET_EXCEEDED',
      options: { details: expect.objectContaining({ spent_usd: 4.9, estimate_usd: 0.42 }) },
    });
  });
});

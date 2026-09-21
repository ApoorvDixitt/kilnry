// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it, vi } from 'vitest';
import { enginePreEstimate, pendingRequests, type EngineEstimate } from './pre-estimate.js';

function priced(usd: number, model = 'fal-ai/kling-video/v3/pro/image-to-video'): EngineEstimate {
  return { estimate: { estimate_usd: usd, route: { provider: 'fal', model }, eta_s: 120 } };
}

describe('pendingRequests (F-CHT-03)', () => {
  it('reads every request a generate call would submit', () => {
    const requests = pendingRequests('kilnry_generate', {
      requests: [
        { kind: 'video', model: 'kling', prompt: 'a reel', params: { duration_s: 5 }, count: 1 },
        { kind: 'image', prompt: 'a still' },
      ],
    });
    expect(requests).toHaveLength(2);
    expect(requests[0]).toEqual({
      kind: 'video',
      model: 'kling',
      prompt: 'a reel',
      params: { duration_s: 5 },
      count: 1,
    });
    // Defaults fill in for what the model left out.
    expect(requests[1]?.model).toBe('auto');
    expect(requests[1]?.count).toBe(1);
  });

  it('reads a transform call as one request named by its operation', () => {
    expect(pendingRequests('kilnry_transform', { op: 'upscale', source: '01J' })[0]?.kind).toBe('upscale');
  });

  it('prices nothing for a tool that does not spend this way', () => {
    expect(pendingRequests('kilnry_library', { query: 'chai' })).toEqual([]);
  });
});

describe('enginePreEstimate (F-CHT-03)', () => {
  it('totals every request and lists one line per call for the card', async () => {
    const estimate = vi.fn(async () => priced(0.84));
    const total = await enginePreEstimate(estimate)('kilnry_generate', {
      requests: [
        { kind: 'video', prompt: 'one' },
        { kind: 'video', prompt: 'two' },
        { kind: 'video', prompt: 'three' },
      ],
    });
    expect(estimate).toHaveBeenCalledTimes(3);
    expect(total.estimate_usd).toBeCloseTo(2.52, 4);
    expect(total.calls).toHaveLength(3);
    expect(total.calls[0]).toEqual({
      kind: 'video',
      model: 'fal-ai/kling-video/v3/pro/image-to-video',
      count: 1,
      estimate_usd: 0.84,
    });
  });

  it('prefers the authoritative price the provider returns when there is one', async () => {
    const estimate = async (): Promise<EngineEstimate> => ({
      estimate: { estimate_usd: 1, authoritative_usd: 1.68, route: { provider: 'fal', model: 'kling' } },
    });
    const total = await enginePreEstimate(estimate)('kilnry_generate', { requests: [{ kind: 'video' }] });
    expect(total.estimate_usd).toBe(1.68);
  });

  it('reports that a cap would be passed so the tool can refuse instead of a card', async () => {
    const estimate = async (): Promise<EngineEstimate> => ({
      estimate: {
        estimate_usd: 40,
        route: { provider: 'fal', model: 'kling' },
        budget: { would_exceed: true },
      },
    });
    const total = await enginePreEstimate(estimate)('kilnry_generate', { requests: [{ kind: 'video' }] });
    expect(total.would_exceed_caps).toBe(true);
  });

  it('shows a request it could not price without inventing a number', async () => {
    const estimate = async (): Promise<EngineEstimate> => {
      throw new Error('no route for that model');
    };
    const total = await enginePreEstimate(estimate)('kilnry_generate', { requests: [{ kind: 'video' }] });
    expect(total.estimate_usd).toBe(0);
    expect(total.calls[0]?.estimate_usd).toBe(0);
  });

  it('prices nothing when the call does not spend', async () => {
    const estimate = vi.fn(async () => priced(1));
    const total = await enginePreEstimate(estimate)('kilnry_library', { query: 'chai' });
    expect(total).toEqual({ estimate_usd: 0, calls: [] });
    expect(estimate).not.toHaveBeenCalled();
  });
});

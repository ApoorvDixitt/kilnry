// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The presets tool over the Model Context Protocol (F-PRE-04). A run is an
// ordinary spend, so it makes the same money round trip as every other spending
// tool: price first, return needs_confirmation, and only charge once the caller
// acknowledges the cost.

import { describe, expect, it, vi } from 'vitest';
import { presetsTool } from './manage.js';
import type { PresetCatalogueServices, PresetSummary, ToolServices } from './types.js';

const summary: PresetSummary = {
  id: 'kilnry.product.ice-cube-splash',
  name: 'Ice Cube Splash',
  category: 'product_shot',
  description: 'Hero product frozen mid-splash.',
  kind: 'image_edit',
  model: 'fal-ai/bytedance/seedream/v4.5/edit',
  indicative_cost_usd: 0.04,
  slots: [{ name: 'product', type: 'media', label: 'Product', required: true }],
  needs: ['fal', 'openrouter'],
  source: 'seed',
  enabled: true,
};

function catalogue(overrides: Partial<PresetCatalogueServices> = {}): PresetCatalogueServices {
  return {
    list: () => [summary],
    get: (id) => (id === summary.id ? summary : undefined),
    resolve: (id, values) =>
      id === summary.id
        ? {
            kind: 'image_edit',
            model: 'fal-ai/bytedance/seedream/v4.5/edit',
            prompt: 'The product in image 1, frozen in ice.',
            params: { aspect_ratio: '1:1' },
            medias: values.product === undefined ? [] : [{ role: 'product', ref: String(values.product) }],
            count: 1,
            missing: values.product === undefined ? ['product'] : [],
            target_folder: 'Product_Shots',
          }
        : undefined,
    ...overrides,
  };
}

function engineDouble(overrides: Record<string, unknown> = {}): NonNullable<ToolServices['engine']> {
  return {
    // The engine answers with the request it routed and the estimate for it.
    estimate: vi.fn(async () => ({
      request: {},
      estimate: { estimate_usd: 0.04, authoritative_usd: 0.04 },
    })),
    createJob: vi.fn(async () => ({ job_id: 'job-1', estimate: { estimate_usd: 0.04 } })),
    ...overrides,
  } as unknown as NonNullable<ToolServices['engine']>;
}

function services(
  overrides: { autoApproveBelowUsd?: number; engine?: NonNullable<ToolServices['engine']> } = {},
): ToolServices {
  const context: ToolServices = {
    db: {} as ToolServices['db'],
    scope: 'full',
    presets: catalogue(),
    engine: overrides.engine ?? engineDouble(),
  };
  if (overrides.autoApproveBelowUsd !== undefined) {
    context.autoApproveBelowUsd = overrides.autoApproveBelowUsd;
  }
  return context;
}

describe('the presets tool (F-PRE-04)', () => {
  it('lists what is installed', async () => {
    const result = await presetsTool.execute({ action: 'list' }, services());
    expect(result.structuredContent.presets).toEqual([summary]);
    expect(result.text).toContain('kilnry.product.ice-cube-splash');
  });

  it('says plainly when no catalogue is available', async () => {
    const bare = services();
    delete bare.presets;
    const result = await presetsTool.execute({ action: 'list' }, bare);
    expect(result.structuredContent.presets).toEqual([]);
    expect(result.text).toBe('No presets are installed.');
  });

  it('returns one preset with its slots', async () => {
    const result = await presetsTool.execute(
      { action: 'get', preset_id: 'kilnry.product.ice-cube-splash' },
      services(),
    );
    expect(result.structuredContent.presets).toEqual([summary]);
  });

  it('refuses to get a preset that is not installed', async () => {
    const result = await presetsTool.execute({ action: 'get', preset_id: 'nope' }, services());
    expect((result.structuredContent.error as { code: string }).code).toBe('NOT_FOUND');
  });

  it('asks for the inputs a run still needs before pricing anything', async () => {
    const context = services();
    const result = await presetsTool.execute(
      { action: 'run', preset_id: 'kilnry.product.ice-cube-splash', inputs: {} },
      context,
    );
    const error = result.structuredContent.error as { code: string; message: string };
    expect(error.code).toBe('INVALID_INPUT');
    expect(error.message).toContain('product');
    expect(context.engine?.estimate).not.toHaveBeenCalled();
  });

  it('prices a run and waits for the cost to be acknowledged', async () => {
    const context = services();
    const result = await presetsTool.execute(
      {
        action: 'run',
        preset_id: 'kilnry.product.ice-cube-splash',
        inputs: { product: 'asset-1' },
      },
      context,
    );
    expect(result.structuredContent.needs_confirmation).toBe(true);
    expect(result.structuredContent.total_estimate_usd).toBe(0.04);
    expect(context.engine?.createJob).not.toHaveBeenCalled();
  });

  it('runs once the acknowledged cost matches, and records the preset', async () => {
    const context = services();
    const result = await presetsTool.execute(
      {
        action: 'run',
        preset_id: 'kilnry.product.ice-cube-splash',
        inputs: { product: 'asset-1' },
        confirm_cost_usd: 0.04,
      },
      context,
    );
    expect(result.structuredContent.needs_confirmation).toBeUndefined();
    expect((result.structuredContent.jobs as Array<{ job_id: string }>)[0]?.job_id).toBe('job-1');
    const call = vi.mocked(context.engine!.createJob).mock.calls[0]?.[0] as {
      preset_id?: string;
      confirmed_by?: string;
      request: { source?: string; target_folder?: string };
    };
    expect(call.preset_id).toBe('kilnry.product.ice-cube-splash');
    expect(call.confirmed_by).toBe('mcp');
    expect(call.request.source).toBe('preset');
    // The preset asked for its own folder, so that is where the result lands.
    expect(call.request.target_folder).toBe('Product_Shots');
  });

  it('runs without a confirmation when the cost is under the automatic threshold', async () => {
    const context = services({ autoApproveBelowUsd: 0.5 });
    const result = await presetsTool.execute(
      {
        action: 'run',
        preset_id: 'kilnry.product.ice-cube-splash',
        inputs: { product: 'asset-1' },
      },
      context,
    );
    expect(result.structuredContent.needs_confirmation).toBeUndefined();
    expect(context.engine?.createJob).toHaveBeenCalledOnce();
  });

  it('reports a pricing failure rather than charging', async () => {
    const context = services({
      engine: engineDouble({
        estimate: vi.fn(async () => {
          throw Object.assign(new Error('No provider can run that.'), { code: 'NO_PROVIDER' });
        }),
      }),
    });
    const result = await presetsTool.execute(
      {
        action: 'run',
        preset_id: 'kilnry.product.ice-cube-splash',
        inputs: { product: 'asset-1' },
        confirm_cost_usd: 0.04,
      },
      context,
    );
    expect((result.structuredContent.error as { code: string }).code).toBe('NO_PROVIDER');
    expect(context.engine?.createJob).not.toHaveBeenCalled();
  });
});

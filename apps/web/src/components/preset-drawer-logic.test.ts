// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import {
  canChangeModel,
  canRun,
  initialValues,
  isFilled,
  missingRequired,
  modelOptions,
  openInCreateQuery,
  paramsSummary,
  runPayload,
  targetFolder,
  type DrawerPreset,
} from './preset-drawer-logic';

function preset(overrides: Partial<DrawerPreset> = {}): DrawerPreset {
  return {
    id: 'kilnry.product.ice-cube-splash',
    name: 'Ice Cube Splash',
    version: '1.0.0',
    description: 'Hero product frozen mid-splash.',
    category: 'product_shot',
    kind: 'image_edit',
    capability: 'image_edit',
    model: {
      id: 'fal-ai/bytedance/seedream/v4.5/edit',
      locked: false,
      alternates: ['bytedance-seed/seedream-4.5'],
    },
    params: { aspect_ratio: '1:1', resolution: '2K' },
    slots: [
      { name: 'product', type: 'media', label: 'Product', required: true, roles: ['product'] },
      {
        name: 'surface',
        type: 'enum',
        label: 'Surface',
        required: false,
        options: ['black slate', 'wet concrete'],
        default: 'black slate',
      },
      { name: 'extra', type: 'text', label: 'Anything else', required: false, default: '' },
    ],
    count: 1,
    indicative_cost_usd: 0.04,
    license: 'CC0-1.0',
    author: 'kilnry',
    target_folder_hint: 'Product_Shots',
    ...overrides,
  };
}

const resolved = {
  prompt: 'The product in image 1, frozen in ice on black slate.',
  params: { aspect_ratio: '1:1', resolution: '2K' },
  medias: [{ role: 'product', ref: 'asset-1' }],
  count: 1,
};

describe('the preset use drawer (F-PRE-02)', () => {
  it('pre-fills every slot that declares a default', () => {
    expect(initialValues(preset())).toEqual({ surface: 'black slate', extra: '' });
  });

  it('treats a blank string as unfilled but zero as filled', () => {
    expect(isFilled('')).toBe(false);
    expect(isFilled('   ')).toBe(false);
    expect(isFilled(undefined)).toBe(false);
    expect(isFilled(0)).toBe(true);
    expect(isFilled('slate')).toBe(true);
  });

  it('blocks Run on an empty required slot and names it', () => {
    const values = initialValues(preset());
    expect(missingRequired(preset(), values)).toEqual(['product']);
    expect(canRun(preset(), values, { estimated: true, running: false, overBudget: false })).toBe(false);
  });

  it('never blocks Run for an optional slot left at its default', () => {
    const values = { ...initialValues(preset()), product: 'asset-1' };
    expect(missingRequired(preset(), values)).toEqual([]);
    expect(canRun(preset(), values, { estimated: true, running: false, overBudget: false })).toBe(true);
  });

  it('holds Run until a price has arrived, and while a run is in flight', () => {
    const values = { ...initialValues(preset()), product: 'asset-1' };
    expect(canRun(preset(), values, { estimated: false, running: false, overBudget: false })).toBe(false);
    expect(canRun(preset(), values, { estimated: true, running: true, overBudget: false })).toBe(false);
    expect(canRun(preset(), values, { estimated: true, running: false, overBudget: true })).toBe(false);
  });

  it('lists the primary model first, then its alternates, then Auto', () => {
    expect(modelOptions(preset())).toEqual([
      'fal-ai/bytedance/seedream/v4.5/edit',
      'bytedance-seed/seedream-4.5',
      'auto',
    ]);
  });

  it('does not repeat Auto when the preset already leaves the choice open', () => {
    const open = preset({ model: { id: 'auto', locked: false, alternates: ['fal-ai/flux-2-pro'] } });
    expect(modelOptions(open)).toEqual(['auto', 'fal-ai/flux-2-pro']);
  });

  it('hides the model control when the preset locks its model', () => {
    expect(canChangeModel(preset())).toBe(true);
    expect(canChangeModel(preset({ model: { id: 'fal-ai/flux-2-pro', locked: true, alternates: [] } }))).toBe(
      false,
    );
  });

  it('summarises the settings as aspect, resolution, duration and count', () => {
    expect(paramsSummary({ aspect_ratio: '1:1', resolution: '2K' }, 1)).toBe('1:1 · 2K · 1 output');
    expect(paramsSummary({ aspect_ratio: '9:16', duration_s: 5 }, 2)).toBe('9:16 · 5 s · 2 outputs');
  });

  it('writes to the folder the preset asks for, else the one in use', () => {
    expect(targetFolder(preset())).toBe('Product_Shots');
    const noHint = preset();
    delete noHint.target_folder_hint;
    expect(targetFolder(noHint, 'Campaign')).toBe('Campaign');
    expect(targetFolder(noHint)).toBe('inbox');
  });

  it('runs as a preset job that remembers the preset and the resolved prompt', () => {
    const payload = runPayload({
      preset: preset(),
      model: 'fal-ai/bytedance/seedream/v4.5/edit',
      resolved,
      confirmedCostUsd: 0.04,
      clientRequestId: 'request-1',
    });
    expect(payload).toMatchObject({
      kind: 'image_edit',
      // Acceptance 2: what Run sends is the resolved prompt, not a re-render.
      prompt: resolved.prompt,
      model: 'fal-ai/bytedance/seedream/v4.5/edit',
      medias: [{ role: 'product', asset_id: 'asset-1' }],
      count: 1,
      target_folder: 'Product_Shots',
      source: 'preset',
      preset_id: 'kilnry.product.ice-cube-splash',
      confirmed_cost_usd: 0.04,
      client_request_id: 'request-1',
    });
  });

  it('carries a negative prompt into the run only when the preset has one', () => {
    const without = runPayload({
      preset: preset(),
      model: 'auto',
      resolved,
      confirmedCostUsd: 0.04,
      clientRequestId: 'r',
    });
    expect('negative_prompt' in without).toBe(false);
    const with_ = runPayload({
      preset: preset(),
      model: 'auto',
      resolved: { ...resolved, negative_prompt: 'warped label' },
      confirmedCostUsd: 0.04,
      clientRequestId: 'r',
    });
    expect(with_.negative_prompt).toBe('warped label');
  });

  it('hands the composer the prompt, model, settings and attachments', () => {
    const query = new URLSearchParams(openInCreateQuery({ preset: preset(), model: 'auto', resolved }));
    expect(query.get('preset')).toBe('kilnry.product.ice-cube-splash');
    expect(query.get('kind')).toBe('image_edit');
    expect(query.get('prompt')).toBe(resolved.prompt);
    expect(query.get('model')).toBe('auto');
    expect(JSON.parse(query.get('params') ?? '{}')).toEqual(resolved.params);
    expect(JSON.parse(query.get('medias') ?? '[]')).toEqual(resolved.medias);
  });
});

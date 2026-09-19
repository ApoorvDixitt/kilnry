// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { Composer, ModeSegment, generateState } from './composer';
import type { PickerModel } from './model-picker';
import type { CostEstimate } from './cost-strip';

let root: Root | undefined;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = new Date('2026-09-19T00:00:00.000Z').getTime();

function imageModel(overrides: Partial<PickerModel> = {}): PickerModel {
  return {
    provider: 'fal',
    model_id: 'fal-ai/flux',
    display_name: 'FLUX',
    capabilities: ['text2image'],
    quality_tier: 'standard',
    tags: [],
    supports: { audio: false, references_max: 0 },
    deprecated_at: null,
    connected: true,
    price: { unit: 'image', amount_usd: 0.05, fetched_at: '2026-09-18T00:00:00.000Z' },
    ...overrides,
  };
}

const estimate: CostEstimate = {
  estimate_usd: 0.05,
  source: 'formula',
  unit_price: { unit: 'image', amount_usd: 0.05, fetched_at: '2026-09-18T00:00:00.000Z' },
  breakdown: [{ label: '$0.05/img x 1', usd: 0.05 }],
  eta_s: 12,
};

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

async function render(node: React.ReactNode): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
  return host;
}

describe('generateState', () => {
  const base = {
    hasAnyKey: true,
    promptEmpty: false,
    hasModelForMode: true,
    estimate,
    overBudget: false,
  };

  it('enables Generate when everything is ready', () => {
    expect(generateState(base)).toEqual({ disabled: false, reason: null });
  });

  it('blocks with the exact reason for each disabled case', () => {
    expect(generateState({ ...base, hasAnyKey: false }).reason).toBe('Add a provider key or start the demo.');
    expect(generateState({ ...base, hasModelForMode: false }).reason).toBe(
      'Add a fal or OpenRouter key for this mode.',
    );
    expect(generateState({ ...base, promptEmpty: true }).reason).toBe('Type a prompt first.');
    expect(generateState({ ...base, estimate: null }).reason).toContain('Refresh prices');
    expect(generateState({ ...base, overBudget: true }).reason).toContain('Daily cap');
  });
});

describe('ModeSegment', () => {
  it('disables Workflow with a reason and selects other modes', async () => {
    const picked: string[] = [];
    const host = await render(<ModeSegment mode="image" onChange={(m) => picked.push(m)} />);
    const buttons = [...host.querySelectorAll('button')];
    const workflow = buttons.find((b) => b.textContent === 'Workflow');
    expect(workflow?.disabled).toBe(true);
    expect(workflow?.title).toBe('Workflows arrive in a later milestone.');
    const video = buttons.find((b) => b.textContent === 'Video') as HTMLButtonElement;
    await act(async () => video.click());
    expect(picked).toEqual(['video']);
  });
});

describe('Composer', () => {
  it('keeps the prompt text when the mode changes', async () => {
    const host = await render(<Composer models={[imageModel()]} estimate={estimate} now={NOW} />);
    const textarea = host.querySelector('textarea') as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(textarea, 'a chai glass on marble');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const video = [...host.querySelectorAll('.mode-segment button')].find(
      (b) => b.textContent === 'Video',
    ) as HTMLButtonElement;
    await act(async () => video.click());
    expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe('a chai glass on marble');
  });

  it('disables Generate with the add-key reason when no provider is connected', async () => {
    const host = await render(
      <Composer models={[imageModel({ connected: false })]} estimate={null} now={NOW} />,
    );
    const generate = [...host.querySelectorAll('button')].find(
      (b) => b.textContent === 'Generate',
    ) as HTMLButtonElement;
    expect(generate.disabled).toBe(true);
    expect(generate.title).toBe('Add a provider key or start the demo.');
  });

  it('shows Plan on the Workflow-aware button only when workflow is active, and Generate otherwise', async () => {
    const host = await render(<Composer models={[imageModel()]} estimate={estimate} now={NOW} />);
    expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Generate')).toBe(true);
  });
});

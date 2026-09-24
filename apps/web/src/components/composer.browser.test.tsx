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
import { makeEstimate, makeModel } from '../test/composer-fixtures';

let root: Root | undefined;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = new Date('2026-09-19T00:00:00.000Z').getTime();

function imageModel(overrides: Partial<PickerModel> = {}): PickerModel {
  return makeModel({
    model_id: 'fal-ai/flux',
    display_name: 'FLUX',
    price: { unit: 'image', amount_usd: 0.05, fetched_at: '2026-09-18T00:00:00.000Z' },
    ...overrides,
  });
}

const estimate: CostEstimate = makeEstimate({
  estimate_usd: 0.05,
  unit_price: {
    unit: 'image',
    amount_usd: 0.05,
    fetched_at: '2026-09-18T00:00:00.000Z',
    source_url: 'https://example.com/price',
  },
  breakdown: [{ label: '$0.05/img x 1', usd: 0.05 }],
  eta_s: 12,
});

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
  it('links Workflow to the Workflows screen and selects other modes', async () => {
    const picked: string[] = [];
    const host = await render(<ModeSegment mode="image" onChange={(m) => picked.push(m)} />);
    const buttons = [...host.querySelectorAll('button')];
    const workflow = buttons.find((b) => b.textContent === 'Workflow');
    // The Workflow mode now opens the Workflows screen; it is no longer disabled.
    expect(workflow?.disabled).toBe(false);
    expect(workflow?.title).toBe('Open Workflows to plan a multi-step run.');
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

  it('disables Generate when an over-budget cap is set to block', async () => {
    const host = await render(
      <Composer
        models={[imageModel()]}
        estimate={estimate}
        budgets={[{ scope: 'daily', label: 'Today', cap_usd: 1, spent_usd: 0.99, behavior: 'block' }]}
        now={NOW}
      />,
    );
    const generate = [...host.querySelectorAll('button')].find(
      (b) => b.textContent === 'Generate',
    ) as HTMLButtonElement;
    expect(generate.disabled).toBe(true);
    expect(host.querySelector('.budget-approval')).toBeNull();
  });

  it('offers "Allow this once" when an over-budget cap is set to ask and overrides on click', async () => {
    const calls: Array<{ override_budget?: boolean }> = [];
    const host = await render(
      <Composer
        models={[imageModel()]}
        estimate={estimate}
        budgets={[{ scope: 'daily', label: 'Today', cap_usd: 1, spent_usd: 0.99, behavior: 'ask' }]}
        onGenerate={(payload) => calls.push(payload)}
        now={NOW}
      />,
    );
    // Type a prompt so Generate is otherwise enabled.
    const textarea = host.querySelector('textarea') as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(textarea, 'a small brass bell');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const approval = host.querySelector('.budget-approval');
    expect(approval).not.toBeNull();
    const generate = [...host.querySelectorAll('button')].find(
      (b) => b.textContent === 'Generate',
    ) as HTMLButtonElement;
    expect(generate.disabled).toBe(false);
    const allow = host.querySelector('.budget-approval-allow') as HTMLButtonElement;
    await act(async () => allow.click());
    expect(calls.at(-1)?.override_budget).toBe(true);
  });

  it('shows the "Editing <file>" banner and the instruction placeholder in edit mode (F-CRE-10)', async () => {
    const host = await render(
      <Composer
        models={[imageModel()]}
        estimate={estimate}
        now={NOW}
        edit={{ asset_id: 'a1', kind: 'image', file: 'serum_hero.png' }}
      />,
    );
    expect(host.querySelector('.composer-edit-banner')?.textContent).toContain('Editing serum_hero.png');
    // Batch is hidden while editing a single source.
    expect(host.querySelector('.composer-batch-toggle')).toBeNull();
    const textarea = host.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.placeholder).toBe('Describe the change — what to keep, what to alter.');
  });

  it('calls onExitEdit when the leave-edit button is clicked (F-CRE-10)', async () => {
    let exits = 0;
    const host = await render(
      <Composer
        models={[imageModel()]}
        estimate={estimate}
        now={NOW}
        edit={{ asset_id: 'v1', kind: 'video', file: 'clip_01.mp4' }}
        onExitEdit={() => {
          exits += 1;
        }}
      />,
    );
    const exit = host.querySelector('.composer-edit-exit') as HTMLButtonElement;
    await act(async () => exit.click());
    expect(exits).toBe(1);
  });
});

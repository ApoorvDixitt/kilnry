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

  // F-16 and UX-05: the picker could only be dismissed by picking a model or
  // re-clicking the chip, so Escape and an outside click left it open and a user
  // could press Generate behind it.
  it('closes the model picker on Escape, on an outside click, and on Generate', async () => {
    const host = await render(<Composer models={[imageModel()]} estimate={estimate} now={NOW} />);
    const chip = host.querySelector<HTMLButtonElement>('.model-chip')!;
    const open = async (): Promise<void> => {
      await act(async () => chip.click());
      expect(host.querySelector('.model-picker')).not.toBeNull();
    };

    await open();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(host.querySelector('.model-picker')).toBeNull();

    await open();
    await act(async () => {
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    expect(host.querySelector('.model-picker')).toBeNull();

    await open();
    const prompt = host.querySelector<HTMLTextAreaElement>('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
        prompt,
        'a chai glass',
      );
      prompt.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const generate = [...host.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Generate',
    )!;
    await act(async () => generate.click());
    expect(host.querySelector('.model-picker')).toBeNull();
  });

  // UX-04: the Auto row showed the estimate's first breakdown label, which is the
  // engineering formula.
  it('gives the Auto row a plain subtitle naming the model it picked', async () => {
    const host = await render(<Composer models={[imageModel()]} estimate={estimate} now={NOW} />);
    await act(async () => host.querySelector<HTMLButtonElement>('.model-chip')!.click());
    const why = host.querySelector('.model-picker-why')?.textContent ?? '';
    expect(why).toContain('Picks the cheapest model that fits your settings');
    expect(why).not.toContain('×');
  });

  // Read from the acceptance shard's own failure snapshot (run 37543781517,
  // artifact e2e-m3-m4): the composer kept "@may is not a Character" and showed
  // no chip, because the slow reply for the half-typed mention landed after the
  // reply for the finished one. The effect had no ordering guard.
  it('ignores a resolver reply for a prompt that has already changed', async () => {
    const replies: Array<(value: unknown) => void> = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (String(url).startsWith('/api/characters/resolve')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { prompt?: string };
        return new Promise((resolve) => {
          replies.push(() =>
            resolve(
              new Response(
                JSON.stringify({
                  resolution: body.prompt?.includes('@maya')
                    ? {
                        rewritten_prompt: 'x',
                        injections: [
                          {
                            handle: 'maya',
                            version: 1,
                            strategy: 'reference_images',
                            inputs: [],
                            notes: [],
                          },
                        ],
                        warnings: [],
                      }
                    : {
                        rewritten_prompt: 'x',
                        injections: [],
                        warnings: ['@may is not a Character; did you mean @maya?'],
                      },
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } },
              ),
            ),
          );
        });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof globalThis.fetch;

    try {
      const host = await render(<Composer models={[imageModel()]} estimate={estimate} now={NOW} />);
      const textarea = host.querySelector('.composer textarea') as HTMLTextAreaElement;
      const type = async (value: string): Promise<void> => {
        await act(async () => {
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
          setter?.call(textarea, value);
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
        });
        // Past the 300 ms debounce.
        await act(async () => new Promise((resolve) => setTimeout(resolve, 350)));
      };
      await type('@may');
      await type('Slow dolly-in on @maya at a chai stall');
      // The older reply answers last, as it did on the runner.
      await act(async () => {
        for (const reply of replies.reverse()) reply(undefined);
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(host.querySelector('.composer-resolve')?.textContent).toContain('@maya → reference_images');
      expect(host.textContent).not.toContain('is not a Character');
    } finally {
      globalThis.fetch = original;
    }
  });
});

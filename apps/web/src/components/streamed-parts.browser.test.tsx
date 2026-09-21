// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The worked example from TRD-11 §13, as a test. A user asks for a five second
// reel with an image attached; the agent resolves the character, prices the job,
// says what it will cost, and then asks to spend. This walks the exact part
// sequence that turn produces and asserts the thread shows the right cards in the
// right order — the check that the rendering map and the approval flow agree.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderParts, type MessagePart } from './chat-screen';

let root: Root | undefined;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

// The parts the turn in §13 streams, in order, as useChat would assemble them.
const exampleParts: MessagePart[] = [
  { type: 'step-start' },
  {
    type: 'tool-kilnry_characters',
    state: 'output-available',
    input: { action: 'resolve_prompt', prompt: '@maya sipping the chai in the attached glass' },
    output: { _summary: '@maya will be sent as a Kling element (anchor + 2 views).' },
  },
  {
    type: 'tool-kilnry_estimate',
    state: 'output-available',
    input: { kind: 'video', model: 'fal-ai/kling-video/v3/pro/image-to-video' },
    output: { _summary: '≈ $1.68 for 5 s with sound (Kling 3.0 Pro + element).', estimate_usd: 1.68 },
  },
  {
    type: 'text',
    text: 'This will cost about $1.68 (Kling 3.0 Pro, 5 s, sound on, @maya as an element). Shall I run it?',
  },
  {
    type: 'tool-kilnry_generate',
    state: 'approval-requested',
    input: { requests: [{ kind: 'video', prompt: '@maya sipping the chai in the attached glass' }] },
    approval: {
      id: 'a1',
      calls: [{ kind: 'video', model: 'kling-3.0-pro', count: 1, estimate_usd: 1.68 }],
    } as never,
  },
];

const handlers = { onApprove: () => {}, onDeny: () => {} };

describe('the worked turn from TRD-11 §13', () => {
  it('shows the two finished calls, the agent line, then the approval card', async () => {
    const host = await render(<div>{renderParts(exampleParts, handlers)}</div>);
    const toolNames = [...host.querySelectorAll('.chat-tool-name')].map((node) => node.textContent);
    expect(toolNames).toEqual(['kilnry_characters', 'kilnry_estimate']);
    expect(host.querySelector('p')?.textContent).toContain('This will cost about $1.68');
    expect(host.querySelector('.chat-approval-card')).not.toBeNull();
  });

  it('keeps the parts in the order they streamed', async () => {
    const host = await render(<div>{renderParts(exampleParts, handlers)}</div>);
    // Only the parts themselves, not anything nested inside a card.
    const order = [...(host.firstElementChild?.children ?? [])].map(
      (node) => node.className || node.tagName.toLowerCase(),
    );
    expect(order[0]).toContain('chat-step-divider');
    expect(order[1]).toContain('chat-tool-card');
    expect(order[2]).toContain('chat-tool-card');
    expect(order[3]).toBe('p');
    expect(order[4]).toContain('chat-approval-card');
  });

  it('shows the human summary of each call rather than raw output', async () => {
    const host = await render(<div>{renderParts(exampleParts, handlers)}</div>);
    const summaries = [...host.querySelectorAll('.chat-tool-summary')].map((node) => node.textContent);
    expect(summaries).toEqual([
      '@maya will be sent as a Kling element (anchor + 2 views).',
      '≈ $1.68 for 5 s with sound (Kling 3.0 Pro + element).',
    ]);
  });

  it('prices the approval card from the planned call', async () => {
    const host = await render(<div>{renderParts(exampleParts, handlers)}</div>);
    expect(host.querySelector('.chat-approval-total strong')?.textContent).toBe('$1.68');
    expect(host.querySelector('.chat-approval-card h3')?.textContent).toBe(
      'The agent wants to run kilnry_generate.',
    );
  });

  it('answers the approval with the identifier the stream carried', async () => {
    const onApprove = vi.fn();
    const host = await render(<div>{renderParts(exampleParts, { onApprove, onDeny: () => {} })}</div>);
    const approve = host.querySelector<HTMLButtonElement>('.chat-approval-actions button');
    await act(async () => approve?.click());
    expect(onApprove).toHaveBeenCalledWith('a1', {});
  });

  it('draws an attached file as a chip', async () => {
    const host = await render(
      <div>
        {renderParts(
          [{ type: 'file', url: 'http://127.0.0.1:3123/api/media/01JAK7Q4', mediaType: 'image/png' }],
          handlers,
        )}
      </div>,
    );
    const chip = host.querySelector<HTMLAnchorElement>('.chat-attachment-chip');
    expect(chip?.textContent).toBe('image/png');
    expect(chip?.getAttribute('href')).toBe('http://127.0.0.1:3123/api/media/01JAK7Q4');
  });

  it('shows a failed call with the message the tool reported', async () => {
    const host = await render(
      <div>
        {renderParts(
          [
            {
              type: 'tool-kilnry_generate',
              state: 'output-error',
              input: { requests: [] },
              errorText: 'The provider refused that prompt.',
            },
          ],
          handlers,
        )}
      </div>,
    );
    expect(host.querySelector('.chat-tool-state')?.textContent).toBe('Failed');
  });
});

describe('failure banners (TRD-11 §14)', () => {
  it('an empty balance points at Providers and offers no retry', async () => {
    const host = await render(
      <div>
        {renderParts(
          [
            {
              type: 'data-error',
              code: 'INSUFFICIENT_FUNDS',
              message: 'Your OpenRouter balance is empty. Top up or switch model.',
              retryable: false,
            },
          ],
          { ...handlers, onRegenerate: () => {} },
        )}
      </div>,
    );
    const banner = host.querySelector('.chat-error-banner');
    expect(banner?.getAttribute('role')).toBe('alert');
    expect(banner?.querySelector('p')?.textContent).toBe(
      'Your OpenRouter balance is empty. Top up or switch model.',
    );
    expect(banner?.querySelector('a')?.getAttribute('href')).toBe('/settings/providers');
    expect(banner?.querySelector('button')).toBeNull();
  });

  it('a dropped stream offers to regenerate', async () => {
    const onRegenerate = vi.fn();
    const host = await render(
      <div>
        {renderParts(
          [
            {
              type: 'data-error',
              code: 'PROVIDER_ERROR',
              message: 'OpenAI stopped part-way through.',
              retryable: true,
            },
          ],
          { ...handlers, onRegenerate },
        )}
      </div>,
    );
    const retry = host.querySelector<HTMLButtonElement>('.chat-error-banner button');
    expect(retry?.textContent).toBe('Regenerate');
    await act(async () => retry?.click());
    expect(onRegenerate).toHaveBeenCalledOnce();
  });

  it('a moderated message shows the sentence without a retry', async () => {
    const host = await render(
      <div>
        {renderParts(
          [
            {
              type: 'data-error',
              code: 'MODERATION_REJECTED',
              message: 'OpenRouter refused that message. Edit it and send it again.',
              retryable: false,
            },
          ],
          { ...handlers, onRegenerate: () => {} },
        )}
      </div>,
    );
    expect(host.querySelector('.chat-error-banner button')).toBeNull();
    expect(host.querySelector('.chat-error-banner a')).toBeNull();
  });
});

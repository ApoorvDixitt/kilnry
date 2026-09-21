// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApprovalCard,
  groupToolCalls,
  summariseArguments,
  ToolCallCard,
  type ToolCallState,
} from './message-parts';

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

describe('summariseArguments (F-CHT-03)', () => {
  it('names the action, task or prompt in one line', () => {
    expect(summariseArguments({ action: 'resolve_prompt' })).toBe('resolve_prompt');
    expect(summariseArguments({ task: 'describe' })).toBe('describe');
    expect(summariseArguments({ requests: [{ prompt: 'a chai reel' }] })).toBe('a chai reel');
  });

  it('clips a long prompt rather than filling the row', () => {
    const summary = summariseArguments({ prompt: 'x'.repeat(300) });
    expect(summary.length).toBeLessThanOrEqual(90);
    expect(summary.endsWith('…')).toBe(true);
  });
});

describe('ToolCallCard (F-CHT-03)', () => {
  it('collapses to the tool, a one-line summary and the state', async () => {
    const host = await render(
      <ToolCallCard
        toolName="kilnry_generate"
        state="output-available"
        input={{ requests: [{ prompt: 'a chai reel' }] }}
        output={{ _summary: 'One video, $0.84.' }}
      />,
    );
    expect(host.querySelector('.chat-tool-name')?.textContent).toBe('kilnry_generate');
    expect(host.querySelector('.chat-tool-summary')?.textContent).toBe('One video, $0.84.');
    expect(host.querySelector('.chat-tool-state')?.textContent).toBe('Done');
    expect(host.querySelector('.chat-tool-body')).toBeNull();
  });

  it('expands to the arguments and the result when opened', async () => {
    const host = await render(
      <ToolCallCard
        toolName="kilnry_models"
        state="output-available"
        input={{ capability: 'image' }}
        output={{ models: ['a'] }}
      />,
    );
    const head = host.querySelector<HTMLButtonElement>('.chat-tool-head');
    expect(head?.getAttribute('aria-expanded')).toBe('false');
    await act(async () => head?.click());
    expect(head?.getAttribute('aria-expanded')).toBe('true');
    const body = host.querySelector('.chat-tool-body');
    expect(body?.textContent).toContain('capability');
    expect(body?.textContent).toContain('models');
  });

  it('shows a count when consecutive calls were grouped', async () => {
    const host = await render(<ToolCallCard toolName="kilnry_generate" state="output-available" count={3} />);
    expect(host.querySelector('.chat-tool-count')?.textContent).toBe('×3');
  });

  it('marks a failed call and shows its message when expanded', async () => {
    const host = await render(
      <ToolCallCard toolName="kilnry_generate" state="output-error" errorText="The provider refused." />,
    );
    expect(host.querySelector('.chat-tool-state')?.textContent).toBe('Failed');
    await act(async () => host.querySelector<HTMLButtonElement>('.chat-tool-head')?.click());
    expect(host.querySelector('.chat-tool-error')?.textContent).toBe('The provider refused.');
  });
});

describe('ApprovalCard (F-CHT-03)', () => {
  const calls = [
    { kind: 'video', model: 'kling-3.0-pro', count: 1, estimate_usd: 0.84 },
    { kind: 'video', model: 'kling-3.0-pro', count: 2, estimate_usd: 1.68 },
  ];

  it('lists every planned call with model, count and cost, and a bold total', async () => {
    const host = await render(
      <ApprovalCard
        toolName="kilnry_generate"
        calls={calls}
        totalUsd={2.52}
        onApprove={() => {}}
        onDeny={() => {}}
      />,
    );
    const headers = [...host.querySelectorAll('.chat-approval-table th')].map((node) => node.textContent);
    expect(headers).toEqual(['Call', 'Model', 'Count', 'Cost']);
    expect(host.querySelectorAll('.chat-approval-table tbody tr')).toHaveLength(2);
    expect(host.querySelector('.chat-approval-total strong')?.textContent).toBe('$2.52');
  });

  it('offers Approve, Edit plan and Deny with their shortcuts', async () => {
    const host = await render(
      <ApprovalCard
        toolName="kilnry_generate"
        calls={calls}
        totalUsd={2.52}
        onApprove={() => {}}
        onDeny={() => {}}
        onEdit={() => {}}
      />,
    );
    const labels = [...host.querySelectorAll('.chat-approval-actions button')].map((node) =>
      node.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(labels).toEqual(['Approve Enter', 'Edit plan', 'Deny Esc']);
  });

  it('approves on Enter and denies on Escape', async () => {
    const onApprove = vi.fn();
    const onDeny = vi.fn();
    await render(
      <ApprovalCard
        toolName="kilnry_generate"
        calls={calls}
        totalUsd={2.52}
        onApprove={onApprove}
        onDeny={onDeny}
      />,
    );
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })));
    expect(onApprove).toHaveBeenCalledOnce();
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(onDeny).toHaveBeenCalledOnce();
  });

  it('passes the session threshold only when the checkbox is ticked', async () => {
    const onApprove = vi.fn();
    const host = await render(
      <ApprovalCard
        toolName="kilnry_generate"
        calls={calls}
        totalUsd={2.52}
        autoApproveUsd={1}
        onApprove={onApprove}
        onDeny={() => {}}
      />,
    );
    expect(host.querySelector('.chat-approval-auto span')?.textContent).toBe(
      'Auto-approve under $1.00 for this session',
    );
    const approve = host.querySelector<HTMLButtonElement>('.chat-approval-actions button');
    await act(async () => approve?.click());
    expect(onApprove).toHaveBeenLastCalledWith({});

    const box = host.querySelector<HTMLInputElement>('.chat-approval-auto input');
    await act(async () => box?.click());
    await act(async () => approve?.click());
    expect(onApprove).toHaveBeenLastCalledWith({ autoApproveBelowUsd: 1 });
  });

  it('names the single tool when only one call is planned', async () => {
    const host = await render(
      <ApprovalCard
        toolName="kilnry_voices"
        calls={[calls[0]!]}
        totalUsd={0.84}
        onApprove={() => {}}
        onDeny={() => {}}
      />,
    );
    expect(host.querySelector('h3')?.textContent).toBe('The agent wants to run kilnry_voices.');
  });
});

describe('groupToolCalls (F-CHT-03)', () => {
  const part = (
    toolName: string,
    state: ToolCallState = 'output-available',
  ): { toolName: string; state: ToolCallState } => ({
    toolName,
    state,
  });

  it('collapses consecutive calls of the same tool and counts them', () => {
    const groups = groupToolCalls([
      part('kilnry_generate'),
      part('kilnry_generate'),
      part('kilnry_generate'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.count).toBe(3);
  });

  it('keeps different tools apart', () => {
    const groups = groupToolCalls([
      part('kilnry_estimate'),
      part('kilnry_generate'),
      part('kilnry_estimate'),
    ]);
    expect(groups.map((group) => group.head.toolName)).toEqual([
      'kilnry_estimate',
      'kilnry_generate',
      'kilnry_estimate',
    ]);
  });

  it('never groups a call that is waiting for approval', () => {
    const groups = groupToolCalls([
      part('kilnry_generate'),
      part('kilnry_generate', 'approval-requested'),
      part('kilnry_generate'),
    ]);
    expect(groups).toHaveLength(3);
  });
});

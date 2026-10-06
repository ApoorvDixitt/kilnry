// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { message } from '../lib/messages';
import { ChatScreen, chatGenerationCost, type ChatModelOption } from './chat-screen';

let root: Root | undefined;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  window.localStorage.clear();
});

async function render(node: React.ReactNode): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
  return host;
}

const models: ChatModelOption[] = [
  { provider: 'openrouter', model: 'anthropic/claude-sonnet-5', price_label: '$2 / $10 per M' },
  { provider: 'openrouter', model: 'openai/gpt-5.6-luna', price_label: '$0.20 / $1.20 per M' },
];

describe('ChatScreen (F-CHT-04)', () => {
  it('splits the conversation and the Workspace, with the three Workspace tabs', async () => {
    const host = await render(<ChatScreen sessionId="session-1" models={models} />);
    expect(host.querySelector('.chat-thread')).not.toBeNull();
    expect(host.querySelector('.chat-workspace')).not.toBeNull();
    const tabs = [...host.querySelectorAll('.chat-workspace-tabs button')].map((node) => node.textContent);
    expect(tabs).toEqual(['Preview', 'Steps', 'Cost']);
  });

  it('opens on Preview and switches the Workspace tab when one is chosen', async () => {
    const host = await render(<ChatScreen sessionId="session-1" models={models} />);
    expect(host.querySelector('.chat-workspace-body')?.textContent).toContain('Assets the agent makes');
    const steps = [...host.querySelectorAll<HTMLButtonElement>('.chat-workspace-tabs button')].find(
      (node) => node.textContent === 'Steps',
    );
    await act(async () => steps?.click());
    expect(host.querySelector('.chat-workspace-body')?.textContent).toContain('The plan appears here');
    expect(steps?.getAttribute('aria-selected')).toBe('true');
  });

  it('offers the Chat and Agent modes with Chat selected', async () => {
    const host = await render(<ChatScreen sessionId="session-1" models={models} />);
    const modes = [...host.querySelectorAll('.chat-modes button')];
    expect(modes.map((node) => node.textContent)).toEqual(['Chat', 'Agent']);
    expect(modes[0]?.getAttribute('aria-selected')).toBe('true');
  });

  it('lists every model with its per-million price and preselects the saved default', async () => {
    const host = await render(
      <ChatScreen
        sessionId="session-1"
        models={models}
        defaultModel={{ provider: 'openrouter', model: 'openai/gpt-5.6-luna' }}
      />,
    );
    const select = host.querySelector<HTMLSelectElement>('.chat-model select');
    expect(select?.value).toBe('openrouter:openai/gpt-5.6-luna');
    expect([...(select?.options ?? [])].map((option) => option.textContent)).toEqual([
      'anthropic/claude-sonnet-5 · $2 / $10 per M',
      'openai/gpt-5.6-luna · $0.20 / $1.20 per M',
    ]);
  });

  it('shows the session budget and the free Ollama chip when there is one', async () => {
    const host = await render(
      <ChatScreen sessionId="session-1" models={models} sessionBudgetUsd={5} ollamaDetected />,
    );
    expect(host.querySelector('.chat-budget')?.textContent).toBe('Session budget: $5.00');
    expect(host.querySelector('.chat-ollama-chip')?.textContent).toBe('Ollama available, free');
  });

  it('replaces the whole screen with one card when no model is connected', async () => {
    const host = await render(<ChatScreen sessionId="session-1" models={[]} />);
    expect(host.querySelector('.chat-panes')).toBeNull();
    expect(host.querySelector('.chat-empty-state h2')?.textContent).toBe(
      'Chat and Agent need a language model.',
    );
    const links = [...host.querySelectorAll('.chat-empty-actions a')].map((node) =>
      node.getAttribute('href'),
    );
    expect(links).toContain('/settings/providers');
    expect(links).toContain('https://ollama.com');
  });

  it('keeps the send button unavailable until something is typed', async () => {
    const host = await render(<ChatScreen sessionId="session-1" models={models} />);
    const send = host.querySelector<HTMLButtonElement>('.chat-composer button');
    expect(send?.disabled).toBe(true);
  });

  // This fails if the budget waits for the server before showing, if an older
  // answer can overwrite a newer change, or if a failed save leaves the screen
  // showing a cap the server never stored (S-24's "$1.00" check, F-CHT-02).
  it('shows a new session cap at once, keeps the newest, and rolls back a failed save', async () => {
    const answers: Array<(ok: boolean) => void> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (input: RequestInfo | URL) =>
          new Promise<Response>((resolve) => {
            if (!String(input).includes('/api/chat/session')) {
              resolve(Response.json({}));
              return;
            }
            answers.push((ok) => resolve(new Response('{}', { status: ok ? 200 : 500 })));
          }),
      ),
    );
    const host = await render(<ChatScreen sessionId="session-1" models={models} sessionBudgetUsd={5} />);
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Session budget"]')!;
    const type = async (value: string): Promise<void> => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    };
    await type('2');
    await type('1');
    // Both changes are on their way; the screen already shows the newest.
    expect(host.querySelector('.chat-budget')?.textContent).toBe('Session budget: $1.00');
    // The newer answer lands first, then the older one: the newest still wins.
    await act(async () => answers[1]!(true));
    await act(async () => answers[0]!(true));
    expect(host.querySelector('.chat-budget')?.textContent).toBe('Session budget: $1.00');
    // A failed save puts back the cap the server holds.
    await type('3');
    await act(async () => answers[2]!(false));
    expect(host.querySelector('.chat-budget')?.textContent).toBe('Session budget: $1.00');
    expect(host.textContent).toContain(message('chat.failed'));
    vi.unstubAllGlobals();
  });

  // F-13 (A.4): picking a model used to change local state only, so the next
  // turn still ran whatever the server had.
  it('sends the chosen model to the session so the next turn uses it', async () => {
    const sent: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('/api/chat/session') && init?.body) {
          sent.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        }
        return Response.json({});
      }),
    );
    const host = await render(<ChatScreen sessionId="session-1" models={models} />);
    const select = host.querySelector<HTMLSelectElement>('.chat-model select')!;
    await act(async () => {
      select.value = 'openrouter:openai/gpt-5.6-luna';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(sent).toEqual([
      {
        session_id: 'session-1',
        llm: { provider: 'openrouter', model: 'openai/gpt-5.6-luna' },
      },
    ]);
    vi.unstubAllGlobals();
  });

  it('restores the divider position the user last chose', async () => {
    window.localStorage.setItem('kilnry.chat.ratio', '0.55');
    const host = await render(<ChatScreen sessionId="session-1" models={models} />);
    const screen = host.querySelector<HTMLElement>('.chat-screen');
    expect(screen?.style.getPropertyValue('--chat-ratio')).toBe('0.55');
  });

  it('ignores a stored ratio outside the allowed range', async () => {
    window.localStorage.setItem('kilnry.chat.ratio', '0.95');
    const host = await render(<ChatScreen sessionId="session-1" models={models} />);
    const screen = host.querySelector<HTMLElement>('.chat-screen');
    expect(screen?.style.getPropertyValue('--chat-ratio')).toBe('0.4');
  });
});

describe('chatGenerationCost (F-CHT-04)', () => {
  it('adds completed generation totals and ignores pending tools', () => {
    expect(
      chatGenerationCost([
        {
          parts: [
            {
              type: 'tool-kilnry_generate',
              state: 'output-available',
              output: { total_estimate_usd: 1.26 },
            },
            {
              type: 'tool-kilnry_generate',
              state: 'approval-requested',
              output: { total_estimate_usd: 9 },
            },
          ],
        },
      ]),
    ).toBe(1.26);
  });
});

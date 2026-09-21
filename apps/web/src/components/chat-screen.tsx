'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The Chat screen (F-CHT-04, wireframes §11). A split pane: the conversation on
// the left at about forty percent, the Workspace on the right at sixty, with a
// draggable divider whose ratio is remembered. The Workspace has three tabs:
// Preview for the assets produced, Steps for the plan, and Cost for the session's
// running spend. On a narrow window the panes stack.
//
// When no language model is connected the whole screen is one card that says so
// and points at the two ways to fix it, because nothing else here can work.

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { message } from '../lib/messages';

const RATIO_KEY = 'kilnry.chat.ratio';
const MIN_RATIO = 0.25;
const MAX_RATIO = 0.7;
const DEFAULT_RATIO = 0.4;

export interface ChatModelOption {
  provider: string;
  model: string;
  price_label: string;
}

export interface ChatScreenProps {
  sessionId: string;
  models: ChatModelOption[];
  defaultModel?: { provider: string; model: string };
  sessionBudgetUsd?: number;
  ollamaDetected?: boolean;
}

type WorkspaceTab = 'preview' | 'steps' | 'cost';

export function ChatScreen({
  sessionId,
  models,
  defaultModel,
  sessionBudgetUsd,
  ollamaDetected = false,
}: ChatScreenProps): React.ReactNode {
  const [ratio, setRatio] = useState(DEFAULT_RATIO);
  const [tab, setTab] = useState<WorkspaceTab>('preview');
  const [mode, setMode] = useState<'chat' | 'agent'>('chat');
  const [selected, setSelected] = useState(
    defaultModel
      ? `${defaultModel.provider}:${defaultModel.model}`
      : models[0]
        ? `${models[0].provider}:${models[0].model}`
        : '',
  );
  const [draft, setDraft] = useState('');
  const dragging = useRef(false);

  const transport = useMemo(
    () => new DefaultChatTransport({ api: '/api/chat', body: { session_id: sessionId } }),
    [sessionId],
  );
  const { messages, sendMessage, status, error } = useChat({ id: sessionId, transport });

  // Remember where the user put the divider.
  useEffect(() => {
    const stored = window.localStorage.getItem(RATIO_KEY);
    const parsed = stored === null ? Number.NaN : Number(stored);
    if (!Number.isNaN(parsed) && parsed >= MIN_RATIO && parsed <= MAX_RATIO) setRatio(parsed);
  }, []);

  const onDrag = useCallback((event: MouseEvent) => {
    if (!dragging.current) return;
    const next = Math.min(Math.max(event.clientX / window.innerWidth, MIN_RATIO), MAX_RATIO);
    setRatio(next);
  }, []);

  const stopDrag = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    window.localStorage.setItem(RATIO_KEY, String(ratio));
  }, [ratio]);

  useEffect(() => {
    window.addEventListener('mousemove', onDrag);
    window.addEventListener('mouseup', stopDrag);
    return () => {
      window.removeEventListener('mousemove', onDrag);
      window.removeEventListener('mouseup', stopDrag);
    };
  }, [onDrag, stopDrag]);

  // No model, no chat: say what to do instead of showing an unusable screen.
  if (models.length === 0) {
    return (
      <section className="chat-empty-state">
        <h2>{message('chat.noKeyTitle')}</h2>
        <p>{message('chat.noKeyBody')}</p>
        <div className="chat-empty-actions">
          <a className="chat-primary" href="/settings/providers">
            {message('chat.noKeyProviders')}
          </a>
          <a className="chat-secondary" href="https://ollama.com" rel="noreferrer noopener" target="_blank">
            {message('chat.noKeyOllama')}
          </a>
        </div>
      </section>
    );
  }

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const text = draft.trim();
    if (text === '') return;
    setDraft('');
    void sendMessage({ text });
  }

  const busy = status === 'submitted' || status === 'streaming';

  return (
    <div className="chat-screen" style={{ ['--chat-ratio' as string]: `${ratio}` }}>
      <header className="chat-header">
        <div className="chat-modes" role="tablist" aria-label={message('chat.title')}>
          {(['chat', 'agent'] as const).map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={mode === item}
              className={mode === item ? 'is-active' : ''}
              onClick={() => setMode(item)}
            >
              {message(item === 'chat' ? 'chat.tabChat' : 'chat.tabAgent')}
            </button>
          ))}
        </div>
        <label className="chat-model">
          <span>{message('chat.modelLabel')}</span>
          <select value={selected} onChange={(event) => setSelected(event.target.value)}>
            {models.map((model) => (
              <option key={`${model.provider}:${model.model}`} value={`${model.provider}:${model.model}`}>
                {model.model} · {model.price_label}
              </option>
            ))}
          </select>
        </label>
        {ollamaDetected ? <span className="chat-ollama-chip">{message('chat.ollamaFree')}</span> : null}
        {typeof sessionBudgetUsd === 'number' ? (
          <span className="chat-budget">
            {message('chat.sessionBudget')}: ${sessionBudgetUsd.toFixed(2)}
          </span>
        ) : null}
      </header>

      <div className="chat-panes">
        <section className="chat-thread" aria-label={message('chat.threadLabel')}>
          <div className="chat-messages">
            {messages.length === 0 ? (
              <p className="chat-thread-empty">{message('chat.emptyThread')}</p>
            ) : (
              messages.map((entry) => (
                <article key={entry.id} className={`chat-message is-${entry.role}`}>
                  <h3>{message(entry.role === 'user' ? 'chat.you' : 'chat.agent')}</h3>
                  {entry.parts.map((part, index) =>
                    part.type === 'text' ? <p key={index}>{part.text}</p> : null,
                  )}
                </article>
              ))
            )}
            {error ? (
              <p className="chat-error" role="alert">
                {message('chat.failed')}
              </p>
            ) : null}
          </div>
          <form className="chat-composer" onSubmit={submit}>
            <label className="chat-composer-field">
              <span className="chat-visually-hidden">{message('chat.composerPlaceholder')}</span>
              <textarea
                rows={2}
                value={draft}
                placeholder={message('chat.composerPlaceholder')}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
              />
            </label>
            <button type="submit" disabled={busy || draft.trim() === ''}>
              {message('chat.send')}
            </button>
          </form>
        </section>

        <button
          type="button"
          className="chat-divider"
          aria-label={message('chat.resizeLabel')}
          onMouseDown={() => {
            dragging.current = true;
          }}
        />

        <section className="chat-workspace" aria-label={message('chat.workspaceLabel')}>
          <div className="chat-workspace-tabs" role="tablist" aria-label={message('chat.workspaceLabel')}>
            {(['preview', 'steps', 'cost'] as const).map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={tab === item}
                className={tab === item ? 'is-active' : ''}
                onClick={() => setTab(item)}
              >
                {message(
                  item === 'preview'
                    ? 'chat.tabPreview'
                    : item === 'steps'
                      ? 'chat.tabSteps'
                      : 'chat.tabCost',
                )}
              </button>
            ))}
          </div>
          <div className="chat-workspace-body" role="tabpanel">
            <p className="chat-workspace-empty">
              {message(
                tab === 'preview'
                  ? 'chat.previewEmpty'
                  : tab === 'steps'
                    ? 'chat.stepsEmpty'
                    : 'chat.costEmpty',
              )}
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
